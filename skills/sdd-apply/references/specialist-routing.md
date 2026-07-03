# Specialist Routing

Use this reference during the `sdd-apply` specialist checkpoint. It is a routing aid, not a replacement for project-local guidance, framework/platform documentation, or specialist skills.

Keep `sdd-apply` as the orchestrator. Load or assign specialist guidance only when the selected Requirement, Scenario, touched files, package/config files, user-visible behavior, or verification risk makes that guidance material.

## Routing Protocol

1. Identify the slice: Story, Requirement, Scenario, touched files, commands, and user-visible behavior.
2. Identify material risk surfaces: UI, backend, data, auth/security, API contract, deployment, migration, AI/model behavior, browser verification, performance, docs, release, or CI/PR readiness.
3. Select the smallest set of specialist guidance that could change implementation, verification, or stop conditions.
4. Prefer project-local guidance first, then framework/platform docs, then available specialist skills or router skills.
5. Record selected, skipped, unavailable, or intentionally avoided specialist guidance in the `tasks.md` `Specialist Checkpoint` table with the consequence for the slice.
6. Stop if specialist findings change product scope, public contracts, auth/security boundaries, data model, migrations, deployment behavior, destructive behavior, or external-service state beyond the selected change.

## Common Signals

| Signal | Specialist Guidance |
|---|---|
| Browser-visible UI, interaction behavior, accessibility, responsive layout, design-system components, or screenshot evidence | Use project UI guidance, design system docs, browser verification tools, or available UI/accessibility/design specialist skills. |
| Server routes, route handlers, RPC/actions, backend functions, webhooks, queues, jobs, or API contracts | Use project backend/API guidance, framework docs, OpenAPI or typed-contract docs, or available backend specialist skills. |
| Database schema, migrations, seed/reset behavior, persistence, subscriptions, data integrity, or generated data artifacts | Use project data guidance, migration docs, ORM/backend-platform docs, or available data/platform specialist skills. |
| Auth, authorization, tenancy, secrets, input/output handling, payments, destructive flows, migrations, or production data | Use security/auth guidance and treat unresolved findings as blockers or `/sdd-review` escalation. |
| AI/model calls, agents, chat, RAG, tools, structured output, embeddings, model/provider choice, or streaming UI | Use current provider/framework docs and verify current model IDs, SDK APIs, and configuration before implementation. |
| Deployment, environment variables, hosting config, domains, logs, cron, storage, queues, cache, or platform state | Use platform docs or CLI guidance. Do not mutate production/platform state without explicit authorization. |
| Package installation, dependency upgrades, framework migration, schema migration, data backfill, or generated-file churn | Select relevant stack guidance and treat broad or irreversible changes as stop conditions unless already authorized. |
| Hard bugs, flaky failures, regressions, production-only symptoms, or performance regressions | Use diagnosis or performance guidance before implementing a speculative fix. |
| CI, PR checks, branch policy, merge readiness, review comments, or publishing | Use project branch/CI guidance and available PR/CI tooling. Do not push or open PRs unless authorized by workflow mode and branch policy. |
| README, architecture, testing, deployment, style, data/API contracts, operations, or current-state docs may become stale | Use project docs guidance and update only supporting docs whose truth value changes. |

## Optional Known Skill Examples

If these skills are installed, they may be useful. They are examples, not package requirements:

- `convex` for Convex schema/functions/auth/performance.
- `clerk-*` for Clerk auth.
- `ai-sdk` for AI SDK usage.
- `next-best-practices` for Next.js boundaries.
- `shadcn`, `building-components`, `web-design-guidelines`, or `ui-ux-pro-max` for UI systems.
- `vercel-cli` or Vercel platform skills for Vercel checks.
- `turborepo` for monorepo build/cache behavior.
- `diagnose` for hard bugs, flaky failures, or regressions.

## Delegation Handoff

When specialist guidance is selected for a delegated implementation or review pass, pass:

- specialist guidance names, docs, or paths to load
- why each one applies to the selected Requirement or Scenario
- files, routes, commands, config files, or runtime surfaces to inspect
- allowed operations and prohibited operations
- verification commands or evidence expected from that specialist perspective
- specific stop conditions that the subagent must report instead of resolving alone

The orchestrator remains responsible for loading `sdd-apply`, selecting the change, validating subagent claims, committing, updating durable SDD artifacts, and deciding whether a stop condition is hit.
