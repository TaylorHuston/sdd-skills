# Available Skill Routing

Use this reference to select and enforce guidance that is materially relevant to a `/sdd-apply` slice. It is a discovery protocol, not a fixed dependency list.

Keep `/sdd-apply` as the orchestrator. Project-local instructions remain authoritative. Available skills contribute domain workflows and checks; they do not own scope, Change status, commits, or Epic truth.

## Discovery Protocol

1. Identify the slice: Story, Requirement, Scenario, touched surfaces, commands, user-visible behavior, and expected evidence.
2. Identify material risk categories: UI/accessibility, backend/API, data/migration, auth/security, AI/model behavior, deployment/platform, performance/diagnosis, testing/browser evidence, documentation, or CI/PR/release.
3. Inspect the skill catalog exposed by the current runtime. Match skills by their descriptions and capabilities, not by a hard-coded name list.
4. Select the smallest set that could materially change implementation, verification, or stop conditions.
5. Read every selected skill completely, including any required references, before acting. Follow its instructions unless they conflict with higher-priority or project-local guidance.
6. If no matching skill is available, use project guidance, current framework/platform documentation, and sound engineering judgment. Do not fabricate, install, or require a skill that the user did not provide or authorize.
7. Stop when selected guidance reveals unapproved product, contract, security, data, migration, deployment, destructive, or external-service scope.

## Capability Signals

| Risk Surface | Guidance To Look For |
|---|---|
| Browser or mobile UI, interaction, accessibility, responsive layout, design systems, or visual evidence | UI/UX, component, accessibility, browser-verification, screenshot, or visual-regression skills and project design guidance. |
| Routes, handlers, RPC/actions, backend functions, webhooks, queues, jobs, or public contracts | Backend, framework, API-contract, OpenAPI, service-integration, or architecture skills. |
| Schema, migrations, persistence, subscriptions, reset/seed behavior, or data integrity | Database, ORM, migration, backend-platform, or data-model skills. |
| Auth, authorization, tenancy, secrets, payments, input/output handling, destructive flows, or production data | Security, auth, privacy, threat-model, or security-review skills. Treat unresolved findings as blockers. |
| AI/model calls, agents, chat, RAG, tools, structured output, embeddings, or streaming | Current provider, SDK, model-routing, evaluation, prompt-safety, or AI-interface skills. Verify current APIs and model identifiers. |
| Deployment, environment variables, hosting, domains, logs, cron, storage, cache, or platform state | Deployment, platform, observability, environment, or CLI skills. Do not mutate external or production state without authorization. |
| Hard bugs, flaky failures, regressions, or performance problems | Diagnosis, debugging, profiling, or performance skills before speculative implementation. |
| Tests, browser evidence, mocks/fakes, coverage, or BDD/TDD design | Testing, TDD, browser-verification, or test-engineering skills. |
| CI, PR feedback, branch policy, merge readiness, publishing, or release work | CI, GitHub/SCM, PR-stewardship, release, or deployment skills, subject to workflow authorization. |
| README, architecture, testing, deployment, style, data/API, operations, or current-state docs may become stale | Documentation or architecture guidance plus the project's existing docs conventions. |

## Enforcement And Delegation

When delegating, pass each selected skill through the orchestration tool's supported skill, path, or mention mechanism. Tell the worker why it applies and require it to read and follow the skill before working.

The handoff should include:

- selected skill or guidance identifiers
- why each applies to the assigned Requirement or Scenario
- files, routes, commands, configuration, or runtime surfaces to inspect
- allowed and prohibited operations
- expected verification or evidence
- stop conditions the worker must return to the orchestrator

The orchestrator must validate that the resulting work reflects the selected guidance. Record only consequential outcomes in the existing Implementation or Verification Ledger. Do not maintain an inventory of skills considered, skipped, or unavailable.
