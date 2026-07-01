# Epic Coherence Subagent Prompt

You are auditing SDD Epic-level coherence.

## Scope

- App root: `APP_ROOT`
- Workflow/vault root: `WORKFLOW_ROOT`
- Epic file: `EPIC_PASDD`
- Embedded Stories: `STORY_SUMMARY`
- Related artifacts: `RELATED_ARTIFACTS`
- Mode: read-only

## Goal

Determine whether the Epic still makes sense as a capability truth source after implementation and verification work. Do not edit files, commit, change lifecycle state, or decide final Epic status.

## Required Context

Read:

- project guidance named by the orchestrator
- the Epic file
- relevant PRD/Product Brief, docs, ADRs, change artifacts, and current-state docs named in scope

## Checks

Evaluate:

- Epic Description, Outcome, Current Scope, Deferred Scope, Cross-Story Concerns, Open Decisions, Notes, and Completion Criteria match the embedded Stories.
- Story set is complete, non-duplicative, and ordered by intended completion/dependency sequence.
- Story IDs are unique across active app Epics unless an explicit migration note says the duplicate blocks further implementation.
- Story ownership still makes sense for this Epic; recommend moving Stories to more focused Epics when the current Epic has become an MVP/container artifact.
- Story IDs are stable and sensible for current order, and remain traceable across rename, reorder, split, merge, or Epic moves.
- Potential Stories are still potential, should be formalized, or should be deferred/removed.
- Requirements and Scenarios are not absorbing implementation-only technical details that belong in design, ADRs, data docs, or tasks.
- PRD/product direction and public docs do not contradict the Epic.
- The Epic is usable for future `/sdd-propose`, `/sdd-apply`, and `/sdd-review` work.
- Related change folders do not contradict their lifecycle state when they are used as evidence.

## Report Back

Return:

- Epic coherence result: `aligned`, `changes-requested`, `needs artifact fix`, `needs missing story`, `needs product decision`, `blocked`
- findings by severity with file/path references
- Story ordering, ID, scope, split/merge, or missing Story recommendations
- product/docs drift concerns
- recommended remediation workflow
- evidence inspected
- residual risks

Do not include a self-improvement conclusion.
