---
name: sdd-interactive
description: Create and apply a lightweight SDD change in one tracked interactive working session. Use when the user invokes /sdd-interactive or asks for small UI tweaks, minor behavior refinements, polish, narrow bug fixes, or other concrete changes that deserve a durable change record but do not need a full upfront /sdd-change pass. Combines a minimal change/design/tasks setup with an immediate /sdd-apply-style loop, including BDD/TDD where practical, Epic/Requirement/Scenario reconciliation, relevant available-skill guidance, verification, manual confirmation tracking, and closeout consistency.
---

# SDD Interactive

Create the smallest useful SDD change record, then immediately work through the change interactively.

## Authority And Project Profile

Resolve the workspace, Space, idea-owned planning path, and every target implementation repository with `sdd context <relevant-path> --json`. Retain the resolved workspace root and pass `--workspace <workspace-root>` to subsequent SDD commands whenever the target repository is external to the workspace or the command's current directory is not inside that workspace. Then read the `workflowPath` returned by `sdd context` completely before creating or reconciling SDD artifacts. The dated Change is one workspace-level record under `<workspace>/.sdd/changes/<change-id>/`; its `change.md` names the Space and stable portable repository IDs. Epics, ADRs, implementation, tests, and supporting docs remain in their owning repositories. Project guidance owns branch and verification policy.

This skill is for tracked working sessions. It is not a replacement for `/sdd-change` when the change needs substantial product scoping, architecture design, data/auth/API changes, migration planning, or cross-Epic coordination.

Delegation authorization: invoking `/sdd-interactive`, naming `sdd-interactive`, or asking to start/continue a tracked interactive SDD session is explicit permission to use bounded SDD subagents under this skill's delegation model. If the local tool policy requires an explicit user request before spawning subagents, this skill invocation satisfies that requirement for non-trivial implementation, verification, UI review, security review, broad discovery, or fresh-context review tasks that remain inside the selected interactive change. Do not ask for separate subagent permission unless the user asks for no delegation, the requested delegation would exceed the selected change, the tool requires a more specific approval than normal spawning, or a stop condition applies.

## Output

Create or update the one canonical record:

```text
<workspace>/.sdd/changes/<yyyy-mm-dd-change-name>/change.md
<workspace>/.sdd/changes/<yyyy-mm-dd-change-name>/design.md
<workspace>/.sdd/changes/<yyyy-mm-dd-change-name>/tasks.md
```

Use existing central artifacts when the session continues an active Change. Keep `tasks.md` as the shared live ledger for requests, decisions, repository responsibilities, verification, coordination, and resume state. Never create a repository-local Change copy.

## Workflow

1. Select the Space, central Change, and target repositories.
   - Prefer an explicit Space, repository path, or Change ID from the user.
   - Otherwise resolve the nearest intended application repository, then use its configured Space and mapped repositories. Do not write Change artifacts to the workflow package or an implementation repository.
   - Inspect the detailed status result's top-level `activeChanges` to find a possible continuation. A per-repository entry is only a filtered projection of that same central record, not another Change to select or edit.
   - If a matching active Change exists, continue it only when the user's intent clearly matches that Change and its target repository set.
   - For a new session, derive a short kebab-case slug and run `sdd change create <space-id> <slug>`, repeating `--repo <repository-id>` for every intended target. Use stable portable repository IDs from the repository contracts; do not put absolute paths or display names in `change.md`.
   - Let the command assign the workspace-unique dated Change ID and create `<workspace>/.sdd/changes/<change-id>/`. Do not hand-create a dated folder or create one record per repository.
2. Load the minimum required context.
   - Read project-local `AGENTS.md`, branch policy, `README.md`, package/test scripts, and relevant development guidelines in every target repository before editing it.
   - Read root `developer-guide.md` when present and development work is involved.
   - Read each target's project-defined release communication when the change may affect it.
   - Read target repository `docs/epics/*/epic.md` files when existing behavior, Requirements, Scenarios, or Story ownership may be affected.
   - Scan affected repositories' active `docs/epics/**/epic.md` files for existing Story labels/references and legacy Story IDs before adding or renumbering any Story.
   - Check git status in every target repository and preserve unrelated dirty files.
3. Complete the lightweight central artifacts.
   - Fill the scaffold created by `sdd change create`; do not replace it with a separately authored repository record.
   - `change.md`: record why the session exists, in-scope work, explicit out-of-scope work, known Epic/Story impact, release-communication impact, target repositories, and when to stop and route to `/sdd-change`.
   - `design.md`: record the current understanding, high-level technical approach, cross-repository boundaries or sequencing when applicable, alternatives or deferred approaches, affected Epic truth, and open questions.
   - `tasks.md`: record `Resume Here`, target responsibilities, coordination gates, the interactive request log, task checklist, implementation ledger, verification ledger, manual UI confirmation checklist, artifact updates, open questions, and closeout state. Status, Space, and repositories remain in `change.md`.
   - Keep these short. For a small UI tweak, a few bullets are enough, but every targeted repository must have an explicit responsibility and readiness state.
4. Confirm the scope boundary and enter implementation status.
   - Summarize the intended working-session scope, target repository set, ownership split, and any ordering dependency before code edits.
   - Ask only questions needed to avoid wrong or risky edits. Do not ask scope-expanding questions as though they are part of this session.
   - If the user request would materially expand product scope, user-visible behavior, Epic ownership, data model, auth/security model, public API, deployment behavior, or external-service state, leave the central Change `proposed` and recommend `/sdd-change` unless the user explicitly accepts expanding it.
   - Once the lightweight plan is coherent, run `sdd change transition <space-id> <change-id> --from proposed --to planned` once on the central record. Immediately before the first implementation edit, run `sdd change transition <space-id> <change-id> --from planned --to in_progress` once. Neither command accepts or needs `--repo`; never transition repository targets independently or hand-edit past a lifecycle state.
5. Enter the interactive apply loop.
   - Take one user request, manual-testing note, or tweak at a time.
   - Record it in the central `tasks.md` before or immediately after acting, including the responsible repository ID.
   - Classify it as `cosmetic`, `defect`, `verification gap`, `artifact drift`, `requirement refinement`, `small in-scope behavior`, `scope expansion`, or `product drift`.
   - For `cosmetic` changes, make the smallest safe edit, verify the affected surface, and record why no Epic truth changed.
   - For `defect` changes, add or update a focused failing-first test/check when practical, fix the defect, verify, and update scenario-mapped Story evidence.
   - For `verification gap`, produce the missing proof before claiming completion.
   - For `artifact drift`, reconcile `change.md`, `design.md`, `tasks.md`, Epic truth, docs, or release communication before continuing.
   - For `requirement refinement`, update `design.md` and the target Epic Requirement/Scenario before or alongside implementation.
   - For `small in-scope behavior`, add or update the relevant Requirement/Scenario, then implement and verify it.
   - For `scope expansion` or `product drift`, stop unless the user explicitly accepts the expansion in this change.
   - For work spanning repositories, respect recorded ordering and boundary dependencies, keep each repository's implementation and evidence distinct in the shared ledger, and do not call the request complete until every required target slice is complete.
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
   - Continue independent work after spawning. Never wait silently for more than 60 seconds; report what is complete and which delegated result remains. After roughly three minutes of cumulative waiting on one task or wave, interrupt or close the slow agent and finish locally, or re-delegate a narrower question. Close completed or abandoned agents promptly.
   - If no relevant skill is available, continue from the managed workflow, project guidance, current technical documentation, and sound engineering judgment.
   - Record only concrete consequences that changed implementation, verification, artifacts, or stop conditions; do not maintain a skills-considered inventory.
   - Validate important subagent claims before updating durable truth or committing.
8. Reconcile durable truth.
   - Update affected repository-local Epic `Implementation`, behavior-mapped `Implemented By`, `Implementation Gaps`, `Verification`, scenario-mapped `Verified By`, and `Verification Gaps` when implementation or verification reality changes. Every implemented Requirement needs a concrete repository-relative primary code location and stable symbol or searchable anchor.
   - Keep Epic `Verified By` as a scenario-mapped evidence index. Record chronological command output in `tasks.md` instead; broad gates are supporting evidence unless mapped to named behavior.
   - Distinguish evidence types where useful: focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection.
   - Search affected Epic Stories for older Requirements, Scenarios, implementation/verification state, `Implemented By`, `Implementation Gaps`, `Verified By`, or `Verification Gaps` this quick change supersedes, and reconcile them before claiming completion.
   - Keep Story labels or documented legacy Story IDs stable. Preserve local Requirement and Scenario IDs when editing existing truth; add new IDs only for genuinely new behavior.
   - Keep `S#` Story labels unique within each Epic, full Story references traceable, and legacy app-wide Story IDs unique across active Epics in the app. Stop on duplicates unless the session is explicitly resolving the duplicate.
   - Update the project-defined release communication when project policy requires it.
   - Keep public release communication human-facing; do not include internal SDD ledgers, private planning context, secrets, or speculative roadmap promises.
9. Close the working session.
   - Run `sdd validate <space-id> --change <change-id> --repo <repository-id> [--repo <repository-id> ...] --workspace <workspace-root> --json`, filtering the one central record through every target repository needed for the session; resolve deterministic errors introduced by the session and classify warnings. A repository filter selects contextual Epic and repository surfaces, not a Change copy. The lightweight artifact shape may omit full `/sdd-change` detail, but it must still satisfy the validator's shared core contract.
   - Run focused verification for every changed behavior in every affected target and broader checks when risk warrants.
   - For browser-visible or otherwise user-facing app changes, walk the user through what to manually confirm in the UI: app URL, setup state, routes, clicks/inputs, expected results, failure signs, and what feedback would change Requirements, Scenarios, or implementation.
   - Record that walkthrough in `tasks.md` under `Manual UI Confirmation`. If no manual UI confirmation applies, record why.
   - Record manual confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
   - Refresh the central `tasks.md` with the final resume state, per-repository changed files and verification evidence, manual confirmation status, release-communication status, review record state, PR/merge/release state, coordination gates, unresolved gaps, accepted deferred gaps, and commit candidates or commits.
   - Keep the central status `in_progress` while any target has implementation, verification, remediation, or unresolved coordination work. Only after every targeted repository is ready for independent review, run `sdd change transition <space-id> <change-id> --from in_progress --to in_review` once, without `--repo`.
   - Recommend `/sdd-review` before merge or closeout when code, user-visible behavior, security, data, or release state changed.
   - Do not run `sdd change close` unless the user explicitly asks or the closeout path is already authorized by the active workflow.
   - When the user asks to close, finish, merge-and-close, or otherwise complete the Change, first confirm `change.md` remains `status: in_review` and every targeted repository has met its review, manual-confirmation, release-communication, PR/merge, and accepted-gap gates, and no Resume Here, checklist, change, design, task, or review text contradicts completion. Then run `sdd change close <space-id> <change-id> --workspace <workspace-root>` exactly once. Do not pass `--repo`, close targets independently, or move the folder manually. The resulting `<workspace>/.sdd/changes/closed/<change-id>/` location is the closed state; `change.md` retains `status: in_review`.

## Artifact Shape

Use this minimum structure when creating new artifacts. Treat these as trimmed subsets of the `/sdd-change` change, design, and tasks templates, not as an independent template family. If a lightweight session needs fields beyond this shape, either add only the needed `/sdd-change` template section or route the work to `/sdd-change`.

`change.md`:

```markdown
---
status: proposed
space: <space-id>
repositories:
  - <repository-id>
---
# Change: <Title>

## Why

## Interactive Scope Boundary
- In scope:
- Out of scope:
- Stop and route to /sdd-change if:

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
---
status: proposed
space: <space-id>
repositories:
  - <stable-repository-id>
---
# Tasks: <Title>

## Resume Here

## Target Repository Coordination
| Repository ID | Responsibility | Current Slice / Dependency | Required Gate | State |
|---|---|---|---|---|

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
- Per-repository readiness:
- Manual UI confirmation status:
- Release communication status:
- PR / merge / release state:
- Deferred gaps accepted:
- Central Change location:
```

## Stop Conditions

Stop and ask, or recommend `/sdd-change`, when the session reveals:

- a new capability rather than a tweak or narrow refinement
- unclear product intent that affects user-visible behavior
- data model, auth/security, billing, public API, deployment, migration, or external-service changes
- work spanning multiple Epics without a clear ownership story
- changes that cannot be verified safely in the current environment
- unrelated dirty files that overlap the intended edit surface
- manual feedback that contradicts the PRD/Product Brief or existing Epic direction

## Final Response

Summarize:

- canonical central Change folder path
- requests handled
- artifacts and Epics updated
- tests or checks run
- manual UI confirmations the user should perform, or why none apply
- remaining gaps, review needs, and whether `/sdd-review` is recommended
