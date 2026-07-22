# Adaptive Risk Closure

Use this guidance to keep implementation thorough without turning planning into a predicted file-by-file script.

## Principle

The Change describes the accepted end state, observable behavior, durable constraints, and what must ultimately be checked or confirmed. The Implementation Risk And Confirmation Matrix, Decision Fan-Out Ledger, and Verification Environment table are living Apply artifacts. Planning seeds only what is already knowable. `/sdd-apply` revises them from current code, failures, review history, user feedback, and implementation discoveries.

Do not block planning because implementation details or every failure mode are not yet known. Do not treat an initially sparse matrix as permission to ignore risks that become visible later.

## Discovery

- Inspect accepted Requirements, Scenarios, constraints, ADRs, supporting truth, and current code.
- Read only recent `review.md` records relevant to the affected Epic, subsystem, or boundary. Carry forward applicable failure patterns, not unrelated historical findings.
- Seed or refresh known end-state invariants and confirmation obligations in the risk matrix.
- Identify evidence that may require a disposable database, existing-data migration fixture, browser runtime, provider, account, generated-contract comparison, platform device, or another safety boundary.
- Record current readiness honestly. Missing future evidence need not stop unrelated safe work, but it cannot later be treated as verified merely because implementation continued.

## Each Requirement Or Scenario Slice

Re-evaluate the selected slice against the implementation that now exists. Add, remove, or refine risk rows as reality changes. Ask the applicable adversarial questions:

- What authoritative refresh, external update, retry, or reconciliation can change identity, selection, or the collection that owns this state?
- What happens during overlapping writes, autosave, cancellation, failure, restart, partial completion, or recovery?
- Which owner, tenant, Type, permission, environment, or production-mode boundary must refuse the operation without disclosure or mutation?
- What untrusted input or provider output can cross into durable, privileged, or player/user-visible publication?
- What happens to existing populated data during upgrade, rollback, retry, or schema/version transition?
- Which configuration default, generated contract, client, worker, route, fixture, current-state doc, visual guidance, or release claim must change with this decision?
- Which prior Requirement, Scenario, ADR, or accepted evidence has become stale?

Translate relevant answers into focused negative, transition, recovery, authorization, migration, production-path, or rendered checks. Broad green gates support confidence but do not close a risk row by themselves.

## Pattern Parity

When a slice adds a new implementation beside an established adapter, client, route, workspace, worker, migration, command, or other sibling pattern, identify the closest current reference before closing the slice. Maintain a Pattern Parity Matrix in `tasks.md` for the applicable concerns rather than assuming similar shape means equivalent behavior.

Challenge at least the relevant concerns:

- authentication, expired-session recovery, sign-in/sign-out destination, authorization, and owner or tenant isolation
- CSRF or credential acquisition, invalidation, refresh, retry, idempotency, and retry exhaustion
- timeout, abort, cancellation, offline or hung-request recovery, error envelopes, and conflict handling
- pending-write protection, autosave drain, draft preservation, authoritative refresh, and entity identity changes
- route context, return targets, browser history, deep links, generated contracts, configuration, and environment defaults
- loading, empty, unavailable, permission, recovery, responsive, accessibility, and visual-token behavior

For each applicable concern, name the reference location, the new location, the focused proof, and any intentional divergence. `Not applicable` or `intentional divergence` requires a short inspected reason. Do not copy a sibling defect merely to achieve parity; compare the behavior contract and current evidence, not only source shape.

## Stateful Transitions

When a slice owns editable, autosaving, cached, routed, asynchronous, or identity-sensitive state, maintain a Stateful Transition Matrix in `tasks.md`. Exercise the applicable edges, not only static states:

- entity A to entity B, including local editor, undo, cache, selection, and draft isolation
- clean to dirty to navigation, dirty to failed or conflicted save, and immediate navigation before a debounce settles
- historical or filtered parent context to detail and back, plus direct entry and browser back/forward
- authenticated to expired session, sign-out from the new surface, permission loss, and unavailable resources
- slow, rejected, retried, cancelled, and permanently hung requests
- authoritative refresh or external update while local state exists

Each row names the starting state, trigger, expected invariant, focused test or runtime observation, and result. Rendered screenshots can prove visible state, but hidden transport, persistence, identity, or timing claims require deterministic tests, network control, traces, or another direct observation.

## Evidence Claim Integrity

Treat every completion checkbox, `Verified By` row, E2E claim, security claim, and review-handoff statement as a falsifiable claim.

- For automated evidence, name `path#exact test title or stable test anchor` and identify the assertion, route, selector, injected failure, or observation that matters.
- Do not aggregate several Scenarios into one evidence row unless the named test or parameterized case explicitly exercises each one.
- Before claiming E2E, migration, auth, recovery, or production-path coverage, inspect the cited source and confirm the relevant route, command, fixture, failure injection, and assertion exist and are executed by the command that passed.
- Distinguish server-side enforcement from client-side retry, redirect, timeout, draft, navigation, and recovery behavior. One boundary cannot silently prove another.
- A file path, test count, broad green command, manual walkthrough, or reviewer statement is evidence only for what was directly inspected or asserted.
- If the cited proof is missing, too broad, skipped, undiscovered, or weaker than the claim, reopen the checklist item and record a verification gap instead of preserving a green label.

## Decision Fan-Out

Add a Decision Fan-Out Ledger entry whenever user feedback, implementation discovery, replan, ADR change, security rule, default, contract, data model, or experience decision changes the accepted end state or its implementation consequences.

Inspect every materially affected surface, including:

- proposal, design, Requirements, Scenarios, Epics, ADRs, and accepted gaps
- application logic, adapters, workers, routes, clients, generated contracts, schemas, migrations, configuration, and environment examples
- focused tests, fixtures, E2E paths, provider checks, visual states, and manual confirmation
- README, architecture/testing/security/current-state docs, private Idea guidance, and release communication

Record `not affected` only after inspection. Reconcile the fan-out before closing the affected phase or record the exact blocker or accepted gap.

## Verification Environment

Treat environment readiness as continuous state, not a one-time planning questionnaire.

- Establish required safe setup before relying on database, migration, provider, browser, generated-contract, or production-path evidence.
- If setup is unavailable, continue independent safe work when useful, but keep the affected Requirement unverified and make the missing evidence visible in `Resume Here` and the matrix.
- Before marking the affected phase verified, either run the required evidence, obtain an explicit accepted gap when permitted, or stop on the unresolved obligation.
- Never reinterpret a safety wrapper's refusal as application proof.

## Phase Commit

Before committing a completed phase:

- reconcile newly visible risks and decision fan-out
- reconcile triggered Pattern Parity and Stateful Transition rows
- falsify the phase's important evidence claims against their exact tests, assertions, routes, or observations
- prove each applicable risk row or record its explicit gap
- confirm required evidence environments for this phase actually ran
- update Epic truth, supporting docs, ledgers, and current-state claims
- commit the coherent green slice before beginning the next phase
- run generated-contract or commit-sensitive checks against the committed state when applicable

## Immutable Review Handoff

Before transitioning to `in_review`:

- identify the exact source commit and integration target
- require the source commit to contain the implementation and differ from the target when implementation changed
- leave no intended implementation only in the working tree; preserve unrelated dirty state separately and explicitly
- pass commit-sensitive generated-contract, diff, and integration checks
- leave no required risk, fan-out, environment, or verification row silently pending or blocked
- run fresh-context failure-seeking passes against the committed diff for pattern parity, state transitions/data safety, evidence-claim integrity, authority/untrusted input, decision fan-out/supporting truth, and environment/integration readiness

This Apply-side gate reduces predictable review churn. It does not replace independent `/sdd-review`.
