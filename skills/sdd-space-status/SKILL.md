---
name: sdd-space-status
description: Produce a read-only SDD workflow status overview for an application project or space. Use when the user invokes /sdd-space-status or /space-status in the SDD workflow; asks for current SDD status, gaps, risks, Epic and Story coverage, duplicate Story IDs, active or closed change state, closeout consistency, review readiness, implementation drift, verification gaps, changelog impact, or suggested next steps across a project. Reads PRDs/Product Briefs, docs/epics directories, embedded Stories, docs/changes, SDD review and Epic verification reports, CHANGELOG.md, and related docs without changing them unless follow-up edits are explicitly requested.
---

# SDD Space Status

Summarize the current SDD workflow state of an application project from its durable artifacts.

Default to read-only reporting. Do not create, edit, move, close, split, merge, implement, verify, replan, or reconcile artifacts unless the user explicitly asks for follow-up changes.

## Purpose

`/sdd-space-status` answers:

- What product outcomes are represented by the current PRD/Product Brief and Epics?
- Which Epics and embedded Stories exist, what state are they in, and what user paths do they cover?
- Which active or closed SDD changes exist under `docs/changes/`, and do they still match Epic truth?
- What implementation, verification, traceability, Story ownership, changelog, lifecycle, or artifact drift should be addressed next?
- What is the most useful next SDD action?

Keep the SDD north star in mind: Epics are durable capability truth, Stories are embedded capability slices with stable IDs, Requirements and Scenarios describe observable behavior, `docs/changes/*` records proposed and applied work, and review/verification artifacts challenge or confirm truth.

## Inputs

Start from any of these:

- app root, project path, project slug, space name, or current working directory
- PRD/Product Brief, Epic directory, `epic.md`, change folder, `proposal.md`, `design.md`, `tasks.md`, `review.md`, Epic verification report, changelog, Story ID, or Epic ID
- no explicit target, when the current directory clearly identifies the project

Expected artifact locations:

```text
<planning-root>/<project>/prd.md
<app-root>/docs/epics/<key>-<###>-epic-name>/epic.md
<app-root>/docs/epics/<key>-<###>-epic-name>/reviews/*.md
<app-root>/docs/changes/<yyyy-mm-dd-change-name>/{proposal.md,design.md,tasks.md,review.md}
<app-root>/docs/changes/closed/<yyyy-mm-dd-change-name>/{proposal.md,design.md,tasks.md,review.md}
<app-root>/CHANGELOG.md
```

Treat old `docs/stories/`, `.llm/plans/`, `.llm/reviews/`, and legacy root `changes/` as migration or legacy inputs only. Report them when relevant, but do not recommend new writes there unless the user explicitly asks for legacy compatibility.

Treat generated Story indexes such as `docs/epics/index.md` and `docs/epics/story-index.json` as optional project-local validation artifacts. If project scripts intentionally maintain them, report whether they are current and useful. Do not treat their existence as legacy drift by itself.

## Workflow

1. Locate the project.
   - Prefer the nearest directory with `docs/epics/`, `docs/changes/`, `package.json`, `.git/`, or framework config.
   - If invoked from the vault root, infer the project from the user's target or from unambiguous artifact paths.
   - Read relevant workspace and project guidance such as `AGENTS.md`, app-local `AGENTS.md`, `README.md`, and branch policy.
   - Establish and report the app root, app repo git root, display name, PRD path if present, and SDD artifact roots.
   - Treat mismatches between discovered paths, folder names, display names, Epic IDs, Story IDs, and change names as drift findings.
2. Inventory product and durable truth.
   - Read PRD/Product Brief context when present and relevant to product direction.
   - List Epic directories under `docs/epics/` and read each relevant `epic.md`.
   - Parse embedded Stories, Story IDs, statuses when declared, Requirements, Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps`.
   - Check Story ID uniqueness across active Epic files.
   - Note missing expected directories as status facts, not errors.
3. Inventory changes and reviews.
   - List active changes under `docs/changes/`, excluding `docs/changes/closed/`.
   - List closed changes under `docs/changes/closed/` only enough to understand recent completion state and avoid duplicate recommendations.
   - Classify each change by `proposal.md`, `design.md`, `tasks.md`, `review.md`, task checkboxes, Resume Here, blockers, review verdict, manual confirmation status, changelog state, PR/merge state, closeout fields, folder location, and modified time.
   - List Epic verification reports under `docs/epics/*/reviews/` and classify them by result and recency.
   - Read root `CHANGELOG.md` when it exists and active or recent changes appear release-relevant.
4. Check artifact health.
   - Confirm Stories are embedded in Epic `epic.md` files; flag new standalone Story files as legacy drift unless the project intentionally has not migrated.
   - Flag duplicate Story IDs across active Epics as blocking traceability drift unless an explicit migration note says the duplicate is being resolved.
   - Confirm new or modified Stories have stable Story IDs, local `R#` Requirements, local `R#-S#` Scenarios, `Implemented By`, `Verified By`, and `Verification Gaps`.
   - Flag generic Scenarios, stale `AC-#`/`TAC-#` references, missing code maps, missing verification evidence, and broad evidence that does not prove production paths.
   - Flag Story ownership drift: Stories that belong in a different Epic, MVP/container Epics that should be decomposed, duplicated Stories, and Story order that no longer follows dependency or completion sequence.
   - Flag active changes whose design/tasks no longer match Epic truth or implementation reality.
   - Flag closed changes whose `Resume Here`, checklist, review record, manual confirmation status, changelog status, PR/merge state, deferred gaps, or folder location contradict that closed state.
5. Summarize product and Epics.
   - Report PRD/Product Brief health only when it affects current scope, open product questions, or Epic/story alignment.
   - Report each Epic's health, outcome, embedded Story count, important open decisions, verification posture, and suggested move.
   - Do not copy every Requirement or Scenario into the Epic summary; reference the Epic or Story instead.
6. Summarize Stories.
   - Report status, current user path, implementation evidence, verification evidence, gaps, and suggested move.
   - Separate active/in-scope Stories from deferred, moved, archived, or potential Stories when the Epic distinguishes them.
   - Flag Stories that are too granular, overloaded, duplicated, missing traceability, missing verification, stale relative to implementation, or not tied to a meaningful user path.
7. Summarize SDD changes.
   - Classify active changes as `ready`, `active`, `blocked`, `needs review`, `review findings`, `ready to close`, `stale`, or `unknown`.
   - Classify closed changes as historical evidence; do not recommend editing closed changes unless they are misleading enough to create drift.
   - Treat a closed change with contradictory closeout fields as `closed-with-drift`, not clean history.
   - Prefer evidence from `tasks.md` Resume Here, implementation ledger, verification ledger, review verdicts, Epic verification reports, changelog entries, and modification dates over guesses.
8. Identify risks and gaps.
   - Highlight misleading Epic/Story truth, duplicate Story IDs, missing or stale `Implemented By`, missing `Verified By`, open `Verification Gaps`, generic Scenarios, stale `AC-#`/`TAC-#` references, stale change artifacts, stale reviews, missing changelog entries, contradictory closed-change state, lifecycle mistakes, and Product/Epic/Story drift.
   - Call out places where `/sdd-review` is the right next gate for an active change.
   - Call out places where `/sdd-release` is the right next gate because reviewed work is ready for full release checks, changelog finalization, and a PR to `main`.
   - Call out places where `/sdd-epic-verify` is the right next review because Epic outcome, Story ownership, Story order, Story scope quality, completion criteria, or implementation drift is uncertain.
   - Call out places where `/sdd-propose`, `/sdd-apply`, `/sdd-prd`, `/sdd-explore`, `/diagnose`, or `/improve-codebase-architecture` is a better next move than more status work.
9. Suggest next steps.
   - Prioritize next steps by what best preserves Epic/Story truth and code/test evidence.
   - Prefer finishing or reconciling in-progress changes before starting new ones.
   - Prefer verification and traceability closure when behavior appears implemented but unverified.
   - Prefer Product/PRD refresh when product purpose, audience, or scope is stale.

## Status Heuristics

Use these labels unless the project has a local convention:

- Product health: `aligned`, `needs decisions`, `stale`, `missing`, `unknown`
- Epic health: `on track`, `needs decisions`, `needs stories`, `needs verification`, `needs decomposition`, `blocked`, `complete`, `unknown`
- Story health: `ready`, `needs implementation`, `in progress`, `implemented-needs-verification`, `verified`, `needs update`, `misplaced`, `blocked`, `deferred`
- Change health: `ready`, `active`, `blocked`, `needs review`, `review findings`, `ready to close`, `closed`, `closed-with-drift`, `stale`, `unknown`
- Changelog health: `current`, `missing`, `needs update`, `not needed`, `unchecked`

Be explicit when a label is inferred rather than declared in artifacts.

## Output Shape

Use this structure:

```text
Space: <project-or-space>
App root: /absolute/path
App repo git root: /absolute/path
Display name: Product Name
PRD/Product Brief: /absolute/path or none found
SDD artifacts: /absolute/path/docs
Changelog health: current / missing / needs update / not needed / unchecked

Summary:
- ...

Product / Epics:
| Artifact | Health | Scope / Stories | Open Decisions | Suggested Move |
|---|---|---:|---|---|
| ... | ... | ... | ... | ... |

Stories:
| Story | Epic | Health | Implementation / Evidence | Verification | Suggested Move |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

SDD Changes:
| Change | State | Scope | Evidence / Concern | Suggested Move |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

Risks / Gaps:
- [P1] ...
- [P2] ...

Suggested Next Steps:
1. ...
2. ...
3. ...

Useful Commands:
- ...
```

Keep the report concise. Prefer the top 3-5 next steps over an exhaustive backlog. Include absolute file links when referring to local files in user-facing output.

## Priority Guidance

Rank suggested next steps in this order when multiple options compete:

1. Fix misleading Epic or Story truth, especially duplicate Story IDs.
2. Close verification gaps for implemented user paths.
3. Unblock active changes.
4. Fix contradictory closed-change state when closed artifacts no longer agree with review, manual confirmation, changelog, PR/merge, deferred-gap, or folder-location truth.
5. Run `/sdd-review` for completed implementation that has not had an independent gate.
6. Run `/sdd-epic-verify` when Epic ownership, Story order, Story quality, or implementation drift is uncertain.
7. Create or revise a SDD change with `/sdd-propose` when a concrete product/code change is needed.
8. Refresh Product/PRD direction with `/sdd-prd` when product purpose or scope is stale.
9. Start new implementation work with `/sdd-apply`.

## Follow-Up Mode

If the user asks to act on a recommendation:

- Use `/sdd-prd` for Product Brief/PRD creation or revision.
- Use `/sdd-propose` for new changes, Epic updates, Story moves, Story rewrites, technical approach, and task ledger creation.
- Use `/sdd-apply` for applying or continuing a proposed change.
- Use `/sdd-review` for local PR-style review, review findings, PR readiness, or merge readiness.
- Use `/sdd-release` for full release checks, changelog finalization, and PR creation to `main`.
- Use `/sdd-epic-verify` for objective Epic and linked-Story drift review.
- Use `/sdd-explore` for exploratory thinking that may optionally produce a durable exploration note.
- Use `/diagnose` for an active bug, regression, flaky behavior, or performance issue before implementation work.
- Use `/improve-codebase-architecture` for broad architecture discovery outside a single SDD change.

Do not bundle unrelated follow-up actions into the status report unless the user asks for a cleanup pass.

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
- Do not edit skills or doctrine during normal status work unless the user explicitly asks.
