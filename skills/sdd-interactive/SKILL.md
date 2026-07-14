---
name: sdd-interactive
description: Create and apply a lightweight SDD change in one tracked interactive working session. Use when the user invokes /sdd-interactive or asks for small UI tweaks, minor behavior refinements, polish, narrow bug fixes, or other concrete changes that deserve a durable change record but do not need a full upfront /sdd-propose pass. Combines a minimal proposal/design/tasks setup with an immediate /sdd-apply-style loop, including BDD/TDD where practical, Epic/Requirement/Scenario reconciliation, relevant available-skill guidance, verification, manual confirmation tracking, and closeout consistency.
---

# SDD Interactive

Create the smallest useful SDD change record, then immediately work through the change interactively.

## Authority And Project Profile

Load `$sdd-doctrine` before creating or reconciling SDD artifacts. Resolve the idea-owned planning root and target implementation repository through the doctrine relationship model unless project guidance explicitly maps them differently, then create the change under `docs/changes/` and reconcile Epics under `docs/epics/` inside the implementation repository. Project guidance owns branch and commit policy, verification commands, supporting-doc requirements, release conventions, technology constraints, and permissions.

This skill is for tracked working sessions. It is not a replacement for `/sdd-propose` when the change needs substantial product scoping, architecture design, data/auth/API changes, migration planning, or cross-Epic coordination.

Delegation authorization: invoking `/sdd-interactive`, naming `sdd-interactive`, or asking to start/continue a tracked interactive SDD session is explicit permission to use bounded SDD subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial implementation, verification, UI review, security review, broad discovery, or fresh-context review tasks that remain inside the selected interactive change. Do not ask for separate subagent permission unless the user asks for no delegation, the requested delegation would exceed the selected change, the tool requires a more specific approval than normal spawning, or a stop condition applies.

## Output

Create or update:

```text
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/proposal.md
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/design.md
<project-root>/docs/changes/<yyyy-mm-dd-change-name>/tasks.md
```

Use existing artifacts when the session continues an active change. Keep `tasks.md` as the live ledger for requests, decisions, verification, and resume state.

## Workflow

1. Select the project and change.
   - Prefer an explicit project path or change name from the user.
   - Otherwise use the nearest application root with `.git/`, `package.json`, `docs/`, `AGENTS.md`, or existing `docs/changes/`.
   - Do not write to the workflow root unless the workflow root itself is the intended project.
   - Derive a short kebab-case change name and prefix it with today's local shell date: `yyyy-mm-dd-<change-name>`.
   - If a matching active change exists, continue it only when the user's intent clearly matches that change.
2. Load the minimum required context.
   - Read project-local `AGENTS.md`, branch policy, `README.md`, package/test scripts, and relevant development guidelines before editing.
   - Read root `developer-guide.md` when present and development work is involved.
   - Read the project-defined release communication when the change may affect it.
   - Read target `docs/epics/*/epic.md` files when existing behavior, Requirements, Scenarios, or Story ownership may be affected.
   - Scan active `docs/epics/**/epic.md` files for existing Story labels/references and legacy Story IDs before adding or renumbering any Story.
   - Check git status in every repo that may change and preserve unrelated dirty files.
3. Create the lightweight change artifacts.
   - `proposal.md`: record why the session exists, in-scope work, explicit out-of-scope work, known Epic/Story impact, release-communication impact, and when to stop and promote to `/sdd-propose`.
   - `design.md`: record the current understanding, high-level technical approach, alternatives or deferred approaches when relevant, affected Epic truth, and open questions.
   - `tasks.md`: record `Resume Here`, the interactive request log, task checklist, implementation ledger, verification ledger, manual UI confirmation checklist, artifact updates, open questions, and closeout state.
   - Keep these short. For a small UI tweak, a few bullets are enough.
4. Confirm the scope boundary.
   - Summarize the intended working-session scope before code edits.
   - Ask only questions needed to avoid wrong or risky edits.
   - Do not ask scope-expanding questions as though they are part of this session.
   - If the user request would materially expand product scope, user-visible behavior, Epic ownership, data model, auth/security model, public API, deployment behavior, or external-service state, stop and recommend `/sdd-propose` unless the user explicitly accepts expanding the active change.
5. Enter the interactive apply loop.
   - Take one user request, manual-testing note, or tweak at a time.
   - Record it in `tasks.md` before or immediately after acting.
   - Classify it as `cosmetic`, `defect`, `verification gap`, `artifact drift`, `requirement refinement`, `small in-scope behavior`, `scope expansion`, or `product drift`.
   - For `cosmetic` changes, make the smallest safe edit, verify the affected surface, and record why no Epic truth changed.
   - For `defect` changes, add or update a focused failing-first test/check when practical, fix the defect, verify, and update scenario-mapped Story evidence.
   - For `verification gap`, produce the missing proof before claiming completion.
   - For `artifact drift`, reconcile `proposal.md`, `design.md`, `tasks.md`, Epic truth, docs, or release communication before continuing.
   - For `requirement refinement`, update `design.md` and the target Epic Requirement/Scenario before or alongside implementation.
   - For `small in-scope behavior`, add or update the relevant Requirement/Scenario, then implement and verify it.
   - For `scope expansion` or `product drift`, stop unless the user explicitly accepts the expansion in this change.
6. Follow development discipline.
   - Use BDD/TDD for changed behavior when practical: write or update focused tests/checks first, confirm failure for the expected reason when useful, implement, then rerun verification.
   - Do not force tests for pure copy, styling, or documentation edits where a visual/manual check is the right proof.
   - Keep work commit-shaped. Commit only when the user explicitly asks or the active workflow context already authorizes local commits.
   - Do not push, merge, deploy, rebase, mutate production/platform state, delete branches, or touch credentials without explicit authorization.
7. Use available guidance when material.
   - Inspect the skills exposed by the current runtime and select the smallest set whose capabilities could materially change implementation, verification, or stop conditions.
   - Read every selected skill completely, including required references, and enforce it in direct or delegated work.
   - Prefer bounded subagents for non-trivial implementation, verification, UI review, security review, broad discovery, or fresh-context review when tooling allows it.
   - Treat the user's invocation of this skill as standing delegation authorization for bounded subagents inside the selected interactive change.
   - If no relevant skill is available, continue from doctrine, project guidance, current technical documentation, and sound engineering judgment.
   - Record only concrete consequences that changed implementation, verification, artifacts, or stop conditions; do not maintain a skills-considered inventory.
   - Validate important subagent claims before updating durable truth or committing.
8. Reconcile durable truth.
   - Update affected Epic `Implemented By`, `Verified By`, and `Verification Gaps` when implementation or verification reality changes.
   - Keep Epic `Verified By` as a scenario-mapped evidence index. Record chronological command output in `tasks.md` instead; broad gates are supporting evidence unless mapped to named behavior.
   - Distinguish evidence types where useful: focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection.
   - Search affected Epic Stories for older Requirements, Scenarios, `Verified By`, or `Verification Gaps` this quick change supersedes, and reconcile them before claiming completion.
   - Keep Story labels or documented legacy Story IDs stable. Preserve local Requirement and Scenario IDs when editing existing truth; add new IDs only for genuinely new behavior.
   - Keep `S#` Story labels unique within each Epic, full Story references traceable, and legacy app-wide Story IDs unique across active Epics in the app. Stop on duplicates unless the session is explicitly resolving the duplicate.
   - Update the project-defined release communication when project policy requires it.
   - Keep public release communication human-facing; do not include internal SDD ledgers, private planning context, secrets, or speculative roadmap promises.
9. Close the working session.
   - Run focused verification for every changed behavior and broader checks when risk warrants.
   - For browser-visible or otherwise user-facing app changes, walk the user through what to manually confirm in the UI: app URL, setup state, routes, clicks/inputs, expected results, failure signs, and what feedback would change Requirements, Scenarios, or implementation.
   - Record that walkthrough in `tasks.md` under `Manual UI Confirmation`. If no manual UI confirmation applies, record why.
   - Record manual confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Refresh `tasks.md` with the final resume state, changed files, verification evidence, manual confirmation status, release-communication status, review record state, PR/merge state, unresolved gaps, accepted deferred gaps, and commit candidates or commits.
   - Recommend `/sdd-review` before merge or closeout when code, user-visible behavior, security, data, or release state changed.
   - Do not move the change to `docs/changes/closed/` unless the user explicitly asks or the closeout path is already authorized by the active workflow.
   - When the user asks to close, finish, merge-and-close, or otherwise complete the change, first confirm `tasks.md` has no contradictory Resume Here, checklist, review, manual confirmation, release communication, PR/merge, deferred-gap, or folder-location claims, and no proposal/design/tasks/review text still says completed work is not implemented, not verified, or pending unless clearly historical.

## Artifact Shape

Use this minimum structure when creating new artifacts. Treat these as trimmed subsets of the `/sdd-propose` proposal, design, and tasks templates, not as an independent template family. If a lightweight session needs fields beyond this shape, either add only the needed `/sdd-propose` template section or promote the work to `/sdd-propose`.

`proposal.md`:

```markdown
# Proposal: <Title>

## Why

## Interactive Scope Boundary
- In scope:
- Out of scope:
- Stop and promote to /sdd-propose if:

## Epic / Story Impact
- Known affected Epics:
- Known affected Stories:
- Unknown until implementation:

## Release Communication Impact

## Open Questions
```

`design.md`:

```markdown
# Design: <Title>

## Current Understanding

## Technical Approach

## Affected Epic Truth
| Epic | Story | Requirement / Scenario | Impact | Needed Update |
|---|---|---|---|---|

## Alternatives / Deferred

## Open Questions
```

`tasks.md`:

```markdown
# Tasks: <Title>

## Resume Here

## Interactive Log
| Time | Request / Feedback | Classification | Files / Artifacts | Verification |
|---|---|---|---|---|

## Checklist

## Implementation Ledger

## Verification Ledger

## Manual UI Confirmation
- Status: pending user / user confirmed / accepted gap / not applicable
- App URL / route:
- Required setup or test data:
- Steps for the user:
- Expected result:
- Feedback that would change artifacts:

## Artifact Updates

## Open Questions

## Closeout
- Review record:
- Manual UI confirmation status:
- Release communication status:
- PR / merge state:
- Deferred gaps accepted:
- Folder state:
```

## Stop Conditions

Stop and ask, or recommend `/sdd-propose`, when the session reveals:

- a new capability rather than a tweak or narrow refinement
- unclear product intent that affects user-visible behavior
- data model, auth/security, billing, public API, deployment, migration, or external-service changes
- work spanning multiple Epics without a clear ownership story
- changes that cannot be verified safely in the current environment
- unrelated dirty files that overlap the intended edit surface
- manual feedback that contradicts the PRD/Product Brief or existing Epic direction

## Final Response

Summarize:

- change folder path
- requests handled
- artifacts and Epics updated
- tests or checks run
- manual UI confirmations the user should perform, or why none apply
- remaining gaps, review needs, and whether `/sdd-review` is recommended
