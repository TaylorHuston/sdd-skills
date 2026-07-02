---
name: sdd-space-status
description: Produce a read-only re-entry brief for an SDD application project or space. Use when the user invokes /sdd-space-status or /space-status, says it has been a while since working on an app, asks where work left off, asks what the app is, asks what is active, blocked, stale, or recently closed, asks which files to read first, or asks for the likely next SDD action. Reads project guidance, README/docs, Product Briefs/PRDs, Epics, active and recent changes, review reports, Epic verification reports, CHANGELOG.md, git context, and related docs without changing them.
---

# SDD Space Status

Produce a read-only re-entry brief for an app or space after time away.

Orient the user quickly: what the app is, what work was active, where durable SDD truth lives, what looks stale or blocked enough to care about, and what to do next.

This is not an audit gate. Do not edit, close, move, merge, implement, test, verify, replan, or reconcile artifacts. Do not claim full review readiness, release readiness, or Epic alignment unless a dedicated review/verification artifact already supports that claim. Route to `/sdd-review`, `/sdd-epic-verify`, `/sdd-release`, or another focused skill when confidence would require deeper work.

Keep the SDD north star in mind: Epics are the durable capability map; embedded Stories, Requirements, Scenarios, `Implemented By`, `Verified By`, and known gaps should explain what is actually implemented and where to start in the code. `/sdd-space-status` helps the user find that map again, not rebuild the whole map in one pass.

## Inputs

Start from any of these:

- app root, project path, project slug, space name, or current working directory
- PRD/Product Brief, `docs/epics/`, `epic.md`, `docs/changes/`, `proposal.md`, `design.md`, `tasks.md`, `review.md`, Epic verification report, changelog, Story reference, branch name, or app README
- no explicit target, when the current directory clearly identifies the project

Common landmarks:

```text
<planning-root>/<project>/prd.md
<app-root>/AGENTS.md
<app-root>/README.md
<app-root>/docs/README.md
<app-root>/docs/epics/<key>-<###>-epic-name>/epic.md
<app-root>/docs/epics/<key>-<###>-epic-name>/reviews/*.md
<app-root>/docs/changes/<yyyy-mm-dd-change-name>/{proposal.md,design.md,tasks.md,review.md}
<app-root>/docs/changes/closed/<yyyy-mm-dd-change-name>/{proposal.md,design.md,tasks.md,review.md}
<app-root>/CHANGELOG.md
```

Treat old `docs/stories/`, `.llm/plans/`, `.llm/reviews/`, and legacy root `changes/` as migration inputs only. Mention them if they explain where work left off, but do not recommend new writes there unless project guidance explicitly requires legacy compatibility.

Generated Story indexes such as `docs/epics/index.md` and `docs/epics/story-index.json` are optional navigation or validation artifacts. Use them for orientation when present, but do not treat them as canonical truth.

## Re-Entry Depth

Read enough to orient and route. Prefer current, active, and recent artifacts over exhaustive scans.

1. Locate the project.
   - Prefer the nearest directory with `docs/epics/`, `docs/changes/`, `package.json`, `.git/`, framework config, or app-local `AGENTS.md`.
   - If invoked from the vault root, infer the app from the user's target or an unambiguous artifact path.
   - Report the app root, git root, display name, active branch, dirty/clean context, PRD/Product Brief path if present, and main SDD roots.
2. Read local guidance and onboarding docs.
   - Read app-local `AGENTS.md`, `README.md`, `docs/README.md`, and any obvious project guidance that explains branch policy, app purpose, docs inventory, or local workflow.
   - Read workspace SDD doctrine when present and needed to interpret artifact authority or workflow routing.
3. Reconstruct product intent.
   - Read the Product Brief/PRD when present.
   - Read enough README/docs context to answer what the app is, who it is for, and what shape the product currently has.
4. Reconstruct durable SDD truth.
   - Read Epic indexes when present, then relevant `docs/epics/*/epic.md` files.
   - Prefer summary-level understanding: outcomes, current scope, embedded Story list, important open decisions, obvious verification gaps, and the files a developer would inspect first.
   - Do not exhaustively inspect every Requirement and Scenario unless the current work depends on them.
5. Reconstruct where work left off.
   - Read active `docs/changes/*` folders first, especially `tasks.md` Resume Here, task checkboxes, implementation evidence, verification evidence, review status, manual confirmation status, branch/PR/merge state, and closeout notes.
   - Read recent closed changes only enough to avoid recommending already-finished work and to understand recent direction.
   - Read `review.md` and recent Epic verification reports when they affect active work or explain why a change is blocked.
   - Read `CHANGELOG.md` only when active/recent work appears release-relevant.
6. Notice obvious stale or risky context.
   - Mention contradictions that are visible from the artifacts you already read.
   - Do not perform a full drift investigation. If the answer depends on implementation reality, route to `/sdd-review`, `/sdd-epic-verify`, `/sdd-orphan-audit`, `/diagnose`, or `/improve-codebase-architecture`.

## What To Notice

Look for re-entry signals:

- What the app is and which product goal currently matters.
- The active change, active branch, and most useful `Resume Here` instruction.
- Whether work looks `active`, `blocked`, `needs review`, `ready to close`, `recently closed`, or `unknown`.
- Review findings, Epic verification findings, manual confirmation status, and accepted gaps that shape the next move.
- Epics or Stories that are central to current work.
- Supporting docs that are likely useful or stale enough to mention.
- Missing local guidance, unclear product direction, or missing SDD artifacts when that blocks orientation.
- Obvious contradictions such as an active folder that claims work is complete, a closed change that still says pending, or a Story whose evidence clearly does not match the change notes.

Use these labels unless the project declares its own:

- Current work: `active`, `blocked`, `needs review`, `ready to close`, `recently closed`, `unknown`
- Epic/Story posture: `clear enough`, `needs verify`, `stale-looking`, `missing`, `unknown`
- Product direction: `clear`, `needs decisions`, `stale-looking`, `missing`, `unknown`
- Supporting docs: `current-looking`, `possibly stale`, `missing if required`, `unchecked`

Be explicit when a label is inferred rather than declared.

## Output Shape

Use this structure, trimming sections that are not useful for the project:

```text
Space: <project-or-space>
App root: /absolute/path
Git root: /absolute/path
Branch / state: <branch>, <clean/dirty summary>
Product Brief / PRD: /absolute/path or none found
Main SDD files: /absolute/path/docs/epics, /absolute/path/docs/changes

What This App Is:
- ...

Where We Left Off:
- ...

Active Work:
| Change / Branch | State | Resume Point | Why It Matters |
|---|---|---|---|
| ... | ... | ... | ... |

Important Epics / Stories:
| Artifact | Posture | Why Read It First |
|---|---|---|
| ... | ... | ... |

Recent Changes:
- ...

Known Gaps / Risks:
- [P1] ...
- [P2] ...

Likely Next Move:
1. ...
2. ...
3. ...

Useful Files / Commands:
- ...
```

Keep the report concise. Prefer the top 3 next moves over an exhaustive backlog. Include absolute file links when referring to local files in user-facing output.

## Routing

If the likely next action is clear, name the skill that should own it:

- Use `/sdd-prd` when product purpose, audience, scope, or open questions need conversation before more planning.
- Use `/sdd-explore` when the right product or technical path is unclear.
- Use `/sdd-propose` for a new tracked change, Epic/Story update, replan, ADR-worthy design decision, or implementation plan.
- Use `/sdd-apply` when an active change has a clear next implementation slice.
- Use `/sdd-review` when implementation appears done or needs the local PR-style gate.
- Use `/sdd-release` when reviewed work is ready for production-branch release preparation.
- Use `/sdd-epic-verify` when Epic truth, Story ownership, Story order, requirement quality, or implementation drift needs a dedicated audit.
- Use `/sdd-orphan-audit` when implemented behavior may not be captured by any Epic/Story.
- Use `/diagnose` for an active bug, regression, flaky behavior, or performance issue before implementation work.
- Use `/improve-codebase-architecture` for broad architecture discovery outside a single SDD change.

Do not bundle unrelated follow-up actions into the status report. The status report should make the next move obvious, not perform the next move.

## Guardrails

- Stay read-only unless the user explicitly asks for follow-up edits.
- Do not deep-audit Epics, tests, implementation, or docs inventory.
- Do not treat missing docs as findings unless local guidance requires them or their absence blocks orientation.
- Do not treat broad status uncertainty as a defect. Say what was not checked and route to the appropriate deeper skill.
- Do not over-rank low-confidence risks. If a concern is only a hunch, label it as a hunch.
- Do not let the report become a template-compliance review. Mention only drift that affects re-entry or the likely next action.

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
- Do not edit skills or doctrine during normal status work unless the user explicitly asks.
