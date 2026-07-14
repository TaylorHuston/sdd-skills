# Story Drift Subagent Prompt

You are auditing one embedded Story from a SDD Epic for implementation drift.

## Scope

- App root: `APP_ROOT`
- Workflow root: `WORKFLOW_ROOT`
- Epic file: `EPIC_PATH`
- Story reference: `EPIC-ID/S#` or documented legacy Story ID
- Story title: `STORY_TITLE`
- Requirements and Scenarios: `REQUIREMENT_SCENARIO_LIST`
- Claimed implementation: `IMPLEMENTED_BY`
- Claimed verification: `VERIFIED_BY`
- Relevant docs/code/tests: `RELEVANT_PATHS`
- Mode: read-only

## Goal

Determine whether current implementation and verification still satisfy this Story's Requirements and Scenarios, and whether the Story is missing Requirements or Scenarios needed to describe its actual behavior. Do not edit files, commit, modify Change status, or decide final Epic status.

## Required Context

Read:

- project guidance named by the orchestrator
- the Epic file
- the canonical Epic template named by the orchestrator when provided
- relevant code, tests, docs, configs, and generated artifacts listed in scope
- nearby tests or implementation files needed to verify current behavior

## Checks

Evaluate:

- Story shape: capability-level user outcome, not a tiny task or implementation step.
- Story template adherence: promoted Story sections use `### Story S#` for new or normalized Epics, or a documented legacy Story ID when existing references depend on it.
- Story template adherence: each promoted Story includes the expected subsection shape: Story statement, Requirements And Scenarios, `Implemented By`, scenario-mapped `Verified By`, `Verification Gaps`, and Story Notes.
- Story ownership: the Story still belongs in this Epic, or any move/split/merge recommendation is explicit and preserves traceability.
- Requirement completeness: declared Requirements cover the Story's stated capability, current implementation behavior, relevant UI/API/CLI/runtime surfaces, and product/docs claims.
- Scenario completeness: declared Scenarios cover important happy path, failure, empty, validation, permission, recovery, migration, and security-sensitive modes where relevant.
- Missing Requirements or Scenarios: flag behavior implied by code, tests, docs, or runtime surfaces that is not represented in the Story truth.
- Story reference traceability: Story label or documented legacy Story ID, `R#` Requirements, and `R#-S#` Scenarios are present and usable.
- Story reference traceability: flag duplicate `S#` labels inside the same Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs when the orchestrator provides evidence.
- Scenario quality: Scenarios are concrete and not generic workflow placeholders.
- Supersession drift: later Stories or implementation changes have not left this Story's Requirements, Scenarios, `Verified By`, or `Verification Gaps` reading as current truth when they are now superseded or narrowed.
- Implementation drift: current code satisfies each Scenario or the gap is explicit.
- Verification drift: claimed evidence is current, concrete, and mapped to the right Scenario.
- Verification drift: `Verified By` is a scenario-mapped evidence index, not a chronological command log or a broad-only gate list.
- Verification drift: evidence types are not blurred together. Distinguish focused automated tests, broad supporting gates, deterministic E2E, live-provider playtests, manual UI confirmation, and debug/log inspection.
- Verification drift: stale `AC-#` or `TAC-#` references are mapped to current IDs or explicitly marked legacy.
- Missing tests: important behavior lacks focused proof.
- Production-path risk: tests rely on mocks/fakes without enough production-path proof.
- Security/data risk: auth, permissions, data exposure, secrets, migrations, destructive actions, or external services create unresolved risk.

Run safe focused read-only checks when useful and authorized by project scripts. Do not mutate production systems, remote services, secrets, deployments, branches, or external data.

## Report Back

Return:

- Story result: `aligned`, `changes-requested`, `needs artifact fix`, `needs implementation`, `needs verification`, `blocked`
- Scenario coverage matrix with Story label/reference plus Requirement/Scenario IDs
- missing Requirement or Scenario candidates, with rationale and suggested Story/Requirement/Scenario placement
- superseded Requirement, Scenario, evidence, or gap wording that should be reconciled
- commands/checks run and results
- findings by severity with file/path references
- drift type for each finding
- recommended remediation workflow
- evidence inspected
- residual risks
