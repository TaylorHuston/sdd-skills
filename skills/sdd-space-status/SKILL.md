---
name: sdd-space-status
description: Produce a concise read-only re-entry brief for an SDD Space. Use when the user invokes /sdd-space-status or /space-status, says it has been a while since working on an app, asks where work left off, what is active or blocked, which files matter, or what to do next. Wraps the deterministic `sdd status --json` inventory with targeted reading of product context, active Change records, important Epics, review evidence, Git state, and recent local commits.
---

# SDD Space Status

Turn deterministic CLI inventory into a concise re-entry brief: what the Space is, where work stopped, what matters now, and which SDD action should come next.

This skill is a semantic wrapper around `sdd status`, not a second discovery engine. The CLI owns Space IDs, idea-to-repository relationships, Epic and Change enumeration, Change ordering, repository Git state, and machine-readable status. This skill owns interpretation, selective context reading, and next-action routing.

## Authority

Use `sdd context <relevant-path> --json` to resolve the workspace and Space ID, then use `sdd status <space-id> --json` as the inventory. Read the `workflowPath` returned by `sdd context` before interpreting artifact authority, Epic truth, Change status, or workflow routing.

Treat the result's top-level `activeChanges` and `recentChanges` as the unique canonical Change inventories for the Space. Entries under each repository are filtered projections of those same records based on `tasks.md.repositories`; they are not copies or independent lifecycle owners. The CLI output is navigation, not durable product truth. Central active Change artifacts remain working records, repository-local Epics remain the accepted capability map, and implementation/tests reveal runtime reality. Project guidance owns branch policy, required supporting docs, release conventions, and technology-specific constraints.

If the workspace installation is missing, direct the user to `sdd setup [workspace-path]`; if the repository contract is missing, direct them to `sdd init` in that repository. Use `sdd doctor` to diagnose an existing installation.

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
   - Use the top-level `activeChanges`, `recentChanges`, and `activeChangeCount` as the canonical Space-wide inventory. Each Change ID appears there once even when it targets multiple repositories; `recentChanges` contains centrally closed history only.
   - Use mapped repository lifecycle statuses and roles, repository `git` state, `repositoryDetails`, Epic paths, and each repository's `activeChanges` and `recentChanges` as filtered projections for that target. A projected entry points back to its central Change; do not treat it as a repository-owned folder, add projection counts together, or infer a second lifecycle state.
   - Present every active idea and group its active repositories beneath it, including active ideas without a repository and active repositories without an unclosed Change. Omit inactive and archived lifecycle entries from the default workspace summary; use `--all` when complete lifecycle inventory is requested. Keep official application work distinct from prototypes, references, clients, services, and other mapped repositories.
   - If status data is missing or invalid, run `sdd doctor` and report the finding instead of silently inferring a replacement value.
2. Read only the context needed for re-entry.
   - Read the Product Brief/PRD and enough planning context to explain what the Space is and which product goal matters.
   - Read mapped repository `AGENTS.md`, README, and `docs/README.md` when present.
   - In detailed Space mode, read each active repository's last three local commits from its current checked-out history. Capture the commit hash, date, subject, and changed-file summary. Inspect a commit patch only when its subject and file summary do not explain the work or contradict the active Change record. Do not fetch remote history.
   - Deduplicate by Change ID and read each top-level active Change's central `tasks.md` once, especially Resume Here, target repository responsibilities, pending tasks, blockers, verification, review, manual confirmation, branch/PR/merge/release state, coordination gates, and closeout notes. Do not reread or reinterpret it as one artifact per repository projection.
   - When a central Change is `in_progress`, also read its `proposal.md` and `design.md` when present. Reconcile its declared global resume point and each target's current slice, implementation and verification ledgers, referenced files, dependencies, and blockers with the last three commits and current working-tree summary in the relevant repositories. Inspect only the relevant diff or files needed to identify the exact implementation slice that was underway.
   - Read `review.md` or a recent Epic verification report only when the canonical ledger or a repository projection points to it.
   - Read the most relevant repository-local Epic files at summary depth: Outcome, Current Scope, Story Index, Open Decisions, Completion Criteria, and obvious Verification Gaps. Do not exhaustively audit every Requirement or Scenario.
   - Read top-level recent closed Changes from their central records only when needed to avoid recommending completed work or to explain recent direction.
   - Use the CLI-provided branch and concise Git status for each mapped repository. Beyond the required detailed-Space history above, run additional Git inspection only when metadata is unavailable or a targeted contradiction needs diagnosis. Preserve unrelated dirty state and do not mutate it.
3. Reconcile obvious re-entry signals.
   - Identify the central active Change, its most useful global resume point, target repositories, repository-specific branches and work states, cross-target blockers, pending review or acceptance, and important Epic/Story context.
   - For an `in_progress` Change, distinguish its declared global resume point and per-repository ledger states from observed recent work. Summarize the last completed slice, the likely current slice, coordination dependencies, and relevant uncommitted work when evidence supports them. Do not assume a recent commit or dirty file belongs to the Change solely because it is recent.
   - Mention only contradictions visible from the targeted reads. Do not turn re-entry into a full drift, template, security, or implementation audit.
   - Distinguish declared status from inference. Canonical active Change status is `proposed`, `planned`, `in_progress`, or `in_review`. Location under `<workspace>/.sdd/changes/closed/<change-id>/`, not a `closed` frontmatter value or repository projection, determines that the Change is closed.
4. Route the next action.
   - Recommend at most three coherent next moves, with the most likely first.
   - Name the skill that owns deeper work rather than performing it here.

## Output

Keep the brief concise and trim sections that add no value:

```text
Space: <space-id>
Lifecycle: <active / inactive / archived>
Planning path: <absolute path>

Active Changes (canonical central, unique):
- <change-id> [<proposed / planned / in_progress / in_review>] — <absolute central path> — targets: <repository IDs>

Recent Changes (canonical central, unique closed history):
- <change-id> [closed by central path] — <absolute central closed path> — targets: <repository IDs>

Repository: <repository ID, path, lifecycle, and role>
- Git: <branch or detached head, clean or dirty, and concise change counts>
- Recent commits: <last three local commits, newest first>
- Active Change projections: <central Change IDs and statuses relevant to this repository>
- Important Epics: <summary of repository-local Epics>
- Recent Change projections: <central closed Change IDs relevant to this repository>

<repeat the repository section for each mapping; a multi-repository Change may appear in several projection lines but remains one top-level record>

What This Space Is:
- ...

Where We Left Off:
- Central active Change and declared status
- Global resume point plus each target repository's recorded and observed state
- Cross-repository dependencies or blockers
- Review/acceptance state or recent central closed fallback

Important Epics:
| Repository | Epic | Posture | Why It Matters |
|---|---|---|---|
| ... | ... | clear enough / needs verify / stale-looking / unknown | ... |

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
- Do not imply that every central Change belongs to the primary application repository. Preserve the stable target repository IDs, configured roles, and repository-specific ledger state; call out reference or prototype work separately.
- Do not treat a repository's Change projection as a copy, owner, or separately selectable lifecycle record, and do not total projection counts to calculate unique Changes.
- Present the unique central active and recent Change inventories at Space level even when a Change targets multiple repositories. Keep repository-specific Epics, branch state, evidence, and next actions distinct beneath those canonical records.
- Do not treat CLI inventory as proof that Epic claims or implementation are correct.
- Do not claim review, merge, release, or Epic readiness without the dedicated evidence.
- Do not manufacture a Space mapping, Change status, blocker, or risk from naming similarity.
- Do not turn the brief into an exhaustive backlog or compliance report.
