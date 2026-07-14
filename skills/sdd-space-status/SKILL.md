---
name: sdd-space-status
description: Produce a concise read-only re-entry brief for an SDD Space. Use when the user invokes /sdd-space-status or /space-status, says it has been a while since working on an app, asks where work left off, what is active or blocked, which files matter, or what to do next. Wraps the deterministic `sdd status --json` inventory with targeted reading of product context, active Change records, important Epics, review evidence, and git state.
---

# SDD Space Status

Turn deterministic CLI inventory into a concise re-entry brief: what the Space is, where work stopped, what matters now, and which SDD action should come next.

This skill is a semantic wrapper around `sdd status`, not a second discovery engine. The CLI owns Space IDs, idea-to-repository relationships, Epic and Change enumeration, Change ordering, repository Git state, and machine-readable status. This skill owns interpretation, selective context reading, and next-action routing.

## Authority

Use `sdd context <relevant-path> --json` to resolve the workspace and Space ID, then use `sdd status <space-id> --json` as the inventory. Read `<workspaceRoot>/.sdd/story-driven-development.md` before interpreting artifact authority, Epic truth, Change status, or workflow routing.

The CLI output is navigation, not durable product truth. Epics remain the accepted capability map, active Change artifacts remain working records, and implementation/tests reveal runtime reality. Project guidance owns branch policy, required supporting docs, release conventions, and technology-specific constraints.

If the workspace is not initialized or the managed workflow is missing, stop and direct the user to `sdd init` or `sdd doctor`.

## Inputs

Accept a Space ID, planning or repository path, SDD artifact path, project name, or an unambiguous current directory.

- With a Space ID, run `sdd status <space-id> --json` directly.
- With a path, run `sdd context <path> --json`, take `spaceId`, then run the detailed status command.
- With no explicit target, resolve from the current directory or recent conversation context.
- If no Space ID resolves, run `sdd status --json` for active development inventory and ask the user when selection remains ambiguous. Use `sdd status --all --json` only when the user asks for inactive, archived, or complete lifecycle inventory. Do not invent or persist a relationship.

## Workflow

1. Load deterministic inventory.
   - Run `sdd status <space-id> --json`.
   - Use its idea lifecycle status, planning path, mapped repositories, repository lifecycle statuses and roles, repository `git` state, `repositoryDetails`, per-repository activity, Epic paths, recent Changes, effective Change status, stored Change status, and aggregate active Change count.
   - Present every active idea and group its active repositories beneath it, including active ideas without a repository and active repositories without an unclosed Change. Omit inactive and archived lifecycle entries from the default workspace summary; use `--all` when complete lifecycle inventory is requested. Keep official application work distinct from prototypes, references, clients, services, and other mapped repositories; never collapse multiple active repositories into one ambiguous idea-level work state.
   - If status data is missing or invalid, run `sdd doctor` and report the finding instead of silently inferring a replacement value.
2. Read only the context needed for re-entry.
   - Read the Product Brief/PRD and enough planning context to explain what the Space is and which product goal matters.
   - Read mapped repository `AGENTS.md`, README, and `docs/README.md` when present.
   - Read each active Change's `tasks.md`, especially Resume Here, pending tasks, blockers, verification, review, manual confirmation, branch/PR/merge state, and closeout notes.
   - Read `review.md` or a recent Epic verification report only when the inventory or active ledger points to it.
   - Read the most relevant Epic files at summary depth: Outcome, Current Scope, Story Index, Open Decisions, Completion Criteria, and obvious Verification Gaps. Do not exhaustively audit every Requirement or Scenario.
   - Read recent closed Changes only when needed to avoid recommending completed work or to explain recent direction.
   - Use the CLI-provided branch and concise Git status for each mapped repository. Run additional Git inspection only when that metadata is unavailable or a targeted contradiction needs diagnosis. Preserve unrelated dirty state and do not mutate it.
3. Reconcile obvious re-entry signals.
   - Identify the active Change, most useful resume point, branch, blockers, pending review or acceptance, and important Epic/Story context.
   - Mention only contradictions visible from the targeted reads. Do not turn re-entry into a full drift, template, security, or implementation audit.
   - Distinguish declared status from inference. Canonical Change status is `proposed`, `in_progress`, `review`, `replanning`, or `ready_to_close`; folder location under `docs/changes/closed/` means closed.
4. Route the next action.
   - Recommend at most three coherent next moves, with the most likely first.
   - Name the skill that owns deeper work rather than performing it here.

## Output

Keep the brief concise and trim sections that add no value:

```text
Space: <space-id>
Lifecycle: <active / inactive / archived>
Planning path: <absolute path>
Repository: <path, lifecycle, and role>
- Git: <branch or detached head, clean or dirty, and concise change counts>
- Active Changes: <count and current status>
- Important Epics: <summary for this repository>
- Recent Changes: <relevant recent history for this repository>

<repeat the repository section for each mapping; do not merge their Epics or Changes>

Branch / state: <relevant branch and concise dirty-state summary>

What This Space Is:
- ...

Where We Left Off:
- Active Change and declared status
- Resume point, review/acceptance state, or recent closed fallback

Important Epics:
| Epic | Posture | Why It Matters |
|---|---|---|
| ... | clear enough / needs verify / stale-looking / unknown | ... |

Known Gaps / Risks:
- ...

Likely Next Move:
1. ...
2. ...
3. ...

Useful Files / Commands:
- ...
```

Use absolute clickable file links in user-facing output. Say when a conclusion is inferred or an area was not checked.

## Routing

- `/sdd-prd`: product purpose, audience, scope, or direction needs decisions.
- `/sdd-explore`: the product or technical path is still unclear.
- `/sdd-propose`: a new Change or planning revision is needed.
- `/sdd-apply`: an active Change has a clear implementation or remediation slice.
- `/sdd-review`: implementation is ready for the independent local gate.
- `/sdd-release`: reviewed work is ready for production handoff preparation.
- `/sdd-epic-verify`: Epic truth, Story ownership/order, Requirement quality, or implementation drift needs an audit.
- `/sdd-orphan-audit`: implemented behavior may not be represented by an Epic/Story.
- `/diagnose`: an active defect, regression, flaky behavior, or performance problem needs diagnosis.
- `/improve-codebase-architecture`: broad architecture discovery falls outside one Change.

## Guardrails

- Stay read-only. Do not edit, implement, verify, replan, close, merge, release, or reconcile artifacts.
- Do not independently rescan every repository for Epics or Changes when the CLI inventory is healthy.
- Do not imply that every active Change belongs to the primary application repository. Preserve configured repository roles and call out reference or prototype work separately.
- Do not merge repository-specific Epics, Changes, branch state, or next actions into an ambiguous Space-wide list when a Space maps to multiple repositories.
- Do not treat CLI inventory as proof that Epic claims or implementation are correct.
- Do not claim review, merge, release, or Epic readiness without the dedicated evidence.
- Do not manufacture a Space mapping, Change status, blocker, or risk from naming similarity.
- Do not turn the brief into an exhaustive backlog or compliance report.
