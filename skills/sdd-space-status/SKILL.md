---
name: sdd-space-status
description: Produce a concise read-only re-entry brief for an SDD Space. Use when the user invokes /sdd-space-status or /space-status, says it has been a while since working on an app, asks where work left off, what is active or blocked, which files matter, or what to do next. Wraps the deterministic `sdd status --json` inventory with targeted reading of product context, active Change records, important Epics, review evidence, Git state, and recent local commits.
---

# SDD Space Status

Turn deterministic CLI inventory into a concise re-entry brief: what the Space is, where work stopped, what matters now, and which SDD action should come next.

This skill is a semantic wrapper around `sdd status`, not a second discovery engine. The CLI owns Space IDs, idea-to-repository relationships, Epic and Change enumeration, Change ordering, repository Git state, and machine-readable status. This skill owns interpretation, selective context reading, and next-action routing.

## Authority

Use `sdd context <relevant-path> --json` to resolve the workspace and Space ID, then use `sdd status <space-id> --json` as the inventory. Read the `workflowPath` returned by `sdd context` before interpreting artifact authority, Epic truth, Change status, or workflow routing.

The CLI output is navigation, not durable product truth. Epics remain the accepted capability map, active Change artifacts remain working records, and implementation/tests reveal runtime reality. Project guidance owns branch policy, required supporting docs, release conventions, and technology-specific constraints.

If the user installation is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` in that repository. Use `sdd doctor` to diagnose an existing installation.

## Inputs

Accept a Space ID, planning or repository path, SDD artifact path, project name, or an unambiguous current directory.

- With a Space ID, run `sdd status <space-id> --json` directly.
- With a path, run `sdd context <path> --json`, take `spaceId`, then run the detailed status command.
- With no explicit target, resolve from the current directory or recent conversation context.
- If no Space ID resolves, run `sdd status --json` for active development inventory and ask the user when selection remains ambiguous. Use `sdd status --all --json` only when the user asks for inactive, archived, or complete lifecycle inventory. Do not invent or persist a relationship.

A resolved Space ID or path uses detailed Space mode. A workspace-wide inventory remains lightweight: do not read Change artifacts or repository history for every Space unless the user selects one.

## Workflow

1. Load deterministic inventory.
   - Run `sdd status <space-id> --json`.
   - Use its idea lifecycle status, planning path, mapped repositories, repository lifecycle statuses and roles, repository `git` state, `repositoryDetails`, per-repository `activeChanges` and `recentChanges`, Epic paths, effective Change status, stored Change status, and aggregate active Change count. `recentChanges` contains closed history only.
   - Present every active idea and group its active repositories beneath it, including active ideas without a repository and active repositories without an unclosed Change. Omit inactive and archived lifecycle entries from the default workspace summary; use `--all` when complete lifecycle inventory is requested. Keep official application work distinct from prototypes, references, clients, services, and other mapped repositories; never collapse multiple active repositories into one ambiguous idea-level work state.
   - If status data is missing or invalid, run `sdd doctor` and report the finding instead of silently inferring a replacement value.
2. Read only the context needed for re-entry.
   - Read the Product Brief/PRD and enough planning context to explain what the Space is and which product goal matters.
   - Read mapped repository `AGENTS.md`, README, and `docs/README.md` when present.
   - In detailed Space mode, read each active repository's last three local commits from its current checked-out history. Capture the commit hash, date, subject, and changed-file summary. Inspect a commit patch only when its subject and file summary do not explain the work or contradict the active Change record. Do not fetch remote history.
   - Read each active Change's `tasks.md`, especially Resume Here, pending tasks, blockers, verification, review, manual confirmation, branch/PR/merge state, and closeout notes.
   - When a Change is `in_progress`, also read its `proposal.md` and `design.md` when present. Reconcile its declared resume point, current task, implementation and verification ledgers, referenced files, and blockers with the last three commits and current working-tree summary. Inspect only the relevant diff or files needed to identify the exact implementation slice that was underway.
   - Read `review.md` or a recent Epic verification report only when the inventory or active ledger points to it.
   - Read the most relevant Epic files at summary depth: Outcome, Current Scope, Story Index, Open Decisions, Completion Criteria, and obvious Verification Gaps. Do not exhaustively audit every Requirement or Scenario.
   - Read recent closed Changes only when needed to avoid recommending completed work or to explain recent direction.
   - Use the CLI-provided branch and concise Git status for each mapped repository. Beyond the required detailed-Space history above, run additional Git inspection only when metadata is unavailable or a targeted contradiction needs diagnosis. Preserve unrelated dirty state and do not mutate it.
3. Reconcile obvious re-entry signals.
   - Identify the active Change, most useful resume point, branch, blockers, pending review or acceptance, and important Epic/Story context.
   - For an `in_progress` Change, distinguish its declared resume point from observed recent work. Summarize the last completed slice, the likely current slice, and relevant uncommitted work when evidence supports them. Do not assume a recent commit or dirty file belongs to the Change solely because it is recent.
   - Mention only contradictions visible from the targeted reads. Do not turn re-entry into a full drift, template, security, or implementation audit.
   - Distinguish declared status from inference. Canonical active Change status is `proposed`, `planned`, `in_progress`, or `in_review`; folder location under `docs/changes/closed/` means closed.
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
- Recent commits: <last three local commits, newest first>
- Active Changes: <count and current status>
- Important Epics: <summary for this repository>
- Recent Changes: <recent closed history for this repository>

<repeat the repository section for each mapping; do not merge their Epics or Changes>

Branch / state: <relevant branch and concise dirty-state summary>

What This Space Is:
- ...

Where We Left Off:
- Active Change and declared status
- Declared resume point and observed recent work for an in-progress Change
- Review/acceptance state or recent closed fallback

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
- `/sdd-change --brief`: a deferred desired outcome should be retained without technical planning.
- `/sdd-change --plan` or `--replan`: a new implementation plan or active planning revision is needed.
- `/sdd-apply`: an active Change has a clear implementation or remediation slice.
- `/sdd-review`: implementation is ready for the independent local gate.
- `/sdd-release`: reviewed work is ready for production handoff preparation.
- `/sdd-epic-verify`: Epic truth, Story ownership/order, Requirement quality, or implementation drift needs an audit.
- `/sdd-orphan-audit`: implemented behavior may not be represented by an Epic/Story.
- `/diagnose`: an active defect, regression, flaky behavior, or performance problem needs diagnosis.
- `/improve-codebase-architecture`: broad architecture discovery falls outside one Change.

## Guardrails

- Stay read-only. Do not edit, implement, verify, replan, close, merge, release, or reconcile artifacts.
- Do not fetch, checkout, reset, switch branches, or otherwise alter repository state while reading recent history.
- Do not expand workspace-wide inventory into commit-history or Change-artifact scans across every repository.
- Do not independently rescan every repository for Epics or Changes when the CLI inventory is healthy.
- Do not imply that every active Change belongs to the primary application repository. Preserve configured repository roles and call out reference or prototype work separately.
- Do not merge repository-specific Epics, Changes, branch state, or next actions into an ambiguous Space-wide list when a Space maps to multiple repositories.
- Do not treat CLI inventory as proof that Epic claims or implementation are correct.
- Do not claim review, merge, release, or Epic readiness without the dedicated evidence.
- Do not manufacture a Space mapping, Change status, blocker, or risk from naming similarity.
- Do not turn the brief into an exhaustive backlog or compliance report.
