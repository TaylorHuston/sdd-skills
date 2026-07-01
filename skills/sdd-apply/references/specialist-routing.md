# Specialist Routing

Use this reference during the `sdd-apply` specialist checkpoint. It is a routing aid, not a replacement for the specialist skills themselves.

Keep `sdd-apply` as the orchestrator. Load or assign specialist skills only when the selected Requirement, Scenario, touched files, package/config files, or verification risk makes that guidance material.

## Routing Rules

- Prefer existing specialist skills over copying their guidance into this skill.
- Load only the specialist guidance needed for the current slice or review pass.
- Prefer router skills when the exact specialist is unclear.
- Give subagents the selected specialist skill names or paths, the concrete files/surfaces to inspect, and the specific risk to address.
- Record selected, skipped, unavailable, or intentionally avoided specialist guidance in `tasks.md` with the consequence for the slice.
- Treat any specialist finding that changes product scope, auth/security boundaries, data model, migrations, public API, destructive behavior, deployment behavior, or external-service state as a stop condition unless the user already authorized it.

## Common Signals

| Signal | Specialist Guidance |
|---|---|
| `components.json`, shadcn/ui components, registry components, presets, or component installation/update work | Use `shadcn`. For design-system composition, accessibility, or UI quality risk, also consider `building-components`, `web-design-guidelines`, or `ui-ux-pro-max`. |
| Next.js app router, server/client boundary, Suspense, caching, actions, middleware, route handlers, or deployment behavior | Use `next-best-practices` or relevant Vercel/Next skills. |
| `turbo.json`, workspaces, `apps/`, `packages/`, internal packages, affected builds, or monorepo cache behavior | Use `turborepo`. |
| `convex/`, Convex schema/functions, auth integration, migrations, components, subscriptions, or performance concerns | Use the `convex` router first, then `convex-quickstart`, `convex-setup-auth`, `convex-migration-helper`, `convex-create-component`, or `convex-performance-audit` as appropriate. |
| Clerk auth, users, organizations, sessions, JWT templates, webhooks, env pull, deployment verification, or Clerk API work | Use `clerk-cli` for platform/API operations and the more specific Clerk implementation skills for code changes. |
| `.vercel/`, `vercel.json`, deployment status, environment variables, domains, logs, preview access, integrations, cache, cron, Blob, Edge Config, or Vercel platform state | Use `vercel-cli` or the relevant Vercel plugin skill. Do not push, deploy, mutate env vars, or change production/platform state without explicit authorization. |
| AI SDK usage, `ai` or `@ai-sdk/*`, agents, chat, RAG, tools, structured output, embeddings, model/provider choice, or streaming UI | Use `ai-sdk`; verify current docs/source and current model IDs before code changes. |
| Browser-visible UI changes, responsive behavior, screenshots, visual regression, or PR screenshot evidence | Use `agent-browser`, `before-and-after`, or browser verification guidance when available and appropriate. |
| Security-sensitive surfaces: auth/authz, tenant isolation, secrets, input/output handling, file/network access, webhooks, payments, destructive flows, migrations, or production data | Use security-oriented review guidance or a dedicated security review pass. Escalate unresolved risk to `/sdd-review`. |
| Hard bugs, flaky failures, regressions, production-only symptoms, or performance regressions | Use `diagnose` before implementing a speculative fix. |
| GitHub PR, CI, review comments, branch publishing, or Actions logs | Use GitHub plugin skills or local `gh` where the connector does not cover the job. Do not push/open PRs unless authorized by the SDD workflow mode and branch policy. |
| Package installation, dependency upgrades, framework migration, schema migration, data backfill, or generated-file churn | Select the relevant stack specialist and treat broad or irreversible changes as stop conditions unless already authorized. |

## Delegation Handoff

When specialist guidance is selected for a delegated implementation or review pass, pass:

- specialist skill names or paths to load
- why each one applies to the selected Requirement or Scenario
- files, routes, commands, config files, or runtime surfaces to inspect
- allowed operations and prohibited operations
- verification commands or evidence expected from that specialist perspective
- specific stop conditions that the subagent must report instead of resolving alone

The orchestrator remains responsible for loading `sdd-apply`, selecting the change, validating subagent claims, committing, updating durable SDD artifacts, and deciding whether a stop condition is hit.
