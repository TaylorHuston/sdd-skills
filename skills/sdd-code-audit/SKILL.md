---
name: sdd-code-audit
description: Audit the health of an entire application repository or a selected codebase area using independent specialist reviewers and an evidence-validated synthesis. Use when the user invokes /sdd-code-audit, asks for a comprehensive codebase review beyond one Change, wants an application or subsystem assessed for code quality, architecture, testing, security, performance, reliability, UI/UX, accessibility, operations, or SDD traceability, or wants an interactive improvement plan grounded in current code. This is a read-only point-in-time audit, not the change-local /sdd-review integration gate.
---

# SDD Code Audit

Audit codebase health at a pinned snapshot, then turn confirmed findings into a prioritized improvement plan. Keep the audit independent from implementation: do not edit application code, SDD artifacts, or project configuration under this skill.

## Boundary

- Use `/sdd-code-audit` to ask what should be improved across a repository or selected area.
- Use `/sdd-review` to decide whether one implemented Change is ready to integrate.
- Use `/sdd-epic-verify` to decide whether one Epic accurately describes implemented behavior and evidence.
- Use `/sdd-orphan-audit` for focused reverse-traceability and orphan-candidate inventory.
- Use a security-specific audit skill when the user requests a dedicated or compliance-oriented security assessment. A code audit still includes a normal security pass.

The report is advisory and point-in-time. It must identify the reviewed revision and must not become a competing source of implementation truth. Route accepted improvements into Epics and Changes before implementation.

## Inputs And Modes

Default scope is the resolved repository. An explicit file or directory narrows the audit to that area while retaining enough surrounding context to judge its boundaries and callers.

- Default: use independent reviewers at medium reasoning effort when the runtime supports per-agent effort, write a dated report, and discuss the prioritized plan with the user.
- `--thorough`: use the highest practical reviewer reasoning effort, preferably extra high when available; broaden hotspot sampling, dependency and integration analysis, and cross-checking. This increases depth, not scope beyond the selected repository or path.
- `--check`: report in the conversation only. Do not write an audit file.
- `--no-delegate`: run the same review charters on the main thread when subagents are unavailable or explicitly undesired. State that independence was reduced.
- `--focus <concern>`: emphasize one or more concerns without omitting obvious critical risks outside them.

Do not claim a reasoning level the runtime cannot select. Record the actual delegation and effort used.

## Authority And Context

1. Resolve the git root and read project-local `AGENTS.md` plus referenced guidance.
2. Check branch, HEAD, worktrees, submodules, and dirty state. Include current tracked and untracked work in the snapshot unless the user selects a committed revision. Never stash, reset, switch branches, or clean files for an audit.
3. Identify the stack, package boundaries, entry points, tests, generated/vendor/build paths, and project-native verification commands.
4. If the repository has `.sdd/config.yaml`, run `sdd context <target> --json`, read its returned `workflowPath`, and include SDD traceability. If SDD setup is unavailable or unhealthy, report that limitation rather than blocking the conventional code audit.
5. Pin every reviewer to the same repository, scope, HEAD SHA, and working-tree state. Reviewers must not read each other's conclusions.

Exclude dependencies, generated output, vendored code, caches, coverage artifacts, and build output unless their configuration or checked-in contents are themselves part of the risk.

## Review Wave

Use an orchestrator with independent reviewers by default. Give each reviewer `assets/specialist-reviewer-prompt.md`, the shared snapshot, and one distinct charter.

Default charters:

1. **Code quality and architecture**: correctness risks, cohesion, coupling, boundaries, readability, duplication, error handling, dependency direction, and maintainability.
2. **Testing and behavioral correctness**: important behavior, edge cases, failure paths, test quality, brittle or misleading evidence, integration boundaries, and regression exposure.
3. **Security and data safety**: authentication, authorization, trust boundaries, input/output handling, secrets, privacy, persistence, destructive operations, and dependency/configuration risk.
4. **Performance and reliability**: expensive paths, concurrency, resource use, caching, retries, timeouts, failure recovery, observability, and operational resilience.

Add reviewers only when relevant:

- **UI/UX and accessibility** for user-visible interfaces.
- **Operations and delivery** for deployment, migrations, background work, infrastructure, or production-sensitive configuration.
- **Stack specialist** when an available skill or specialist can materially improve framework-specific analysis.
- **SDD traceability** for an SDD-managed repository. Use current Epics and, when useful, the packaged orphan-audit script as evidence; do not duplicate a full Epic verification.

For small scopes, combine compatible charters while preserving independent perspectives. For large repositories, inventory the architecture first, assign reviewers bounded hotspots or package groups, and ensure every material boundary has an owner. Do not equate more agents with better coverage.

Continue useful orchestration work while reviewers run. Keep waits bounded according to the canonical SDD delegation guidance, and complete a missing pass locally when necessary.

## Evidence Standard

Each finding must include:

- severity: `critical`, `high`, `medium`, or `low`
- confidence: `high`, `medium`, or `low`
- concrete file and line, symbol, route, command output, or reproducible behavior
- impact and the conditions required to trigger it
- concise remediation direction, without pretending to have completed implementation planning

Reject findings that are purely stylistic, unsupported, duplicates, outside the selected scope without cross-boundary impact, or based only on a tool warning. Distinguish confirmed defects from risks, maintainability concerns, and opportunities.

The orchestrator must independently inspect evidence for critical and high findings, reconcile reviewer conflicts, sample medium findings, and run focused read-only commands when that materially raises confidence. Never present raw reviewer output as the final result.

## Synthesis

Consolidate validated findings into an actionable sequence:

1. Immediate correctness, security, data, or production risks.
2. High-value reliability, test, architecture, and performance improvements.
3. Maintainability and experience improvements worth scheduling.
4. Explicitly deferred or rejected observations with rationale.

Group related findings into coherent candidate Changes. For each group, state the desired outcome, why it matters, likely scope, dependencies, and verification direction. Do not perform detailed technical planning unless the user asks to continue with `/sdd-change --plan`.

Present the recommended first improvement and invite the user to refine, accept, defer, or reject groups. Use `/sdd-change --brief` for accepted outcomes that should be retained without immediate technical planning. Use `/sdd-change --plan` only when implementation is approaching.

## Output

Unless `--check` is used, write:

```text
<repository>/docs/audits/<yyyy-mm-dd>-code-audit.md
```

Use `assets/code-audit-report-template.md`. If that filename exists for a different snapshot, add a concise scope slug or numeric suffix instead of overwriting it. Create `docs/audits/` only when writing the report.

The report must contain:

- scope, exclusions, branch, HEAD, dirty-state summary, date, and audit depth
- architecture and verification context
- reviewers actually used and any missing capability
- validated findings ordered by severity
- rejected or unresolved reviewer claims when they affect confidence
- cross-cutting themes and candidate Change groups
- recommended first action
- commands and tools used, with relevant limitations
- SDD traceability result when applicable

Keep full tool dumps and speculative observations out of the main report. Summarize them or attach a separate artifact only when the user asks.

## Safety And Stop Conditions

- Remain read-only except for the audit report itself.
- Do not install dependencies, contact production systems, run destructive commands, expose secrets, stage, commit, push, merge, or create Changes.
- Ask before running costly, stateful, credentialed, external, or unusually long checks.
- Stop unsafe inspection when a credible active compromise, destructive-data hazard, or exposed secret requires immediate user attention.
- Report ambiguity when the repository or requested scope cannot be resolved reliably.
- Preserve unrelated dirty state and disclose when it limits confidence.

## Final Response

Lead with `audit complete`, `no material findings`, or `blocked`.

Include the report path when written, reviewed snapshot and scope, highest-severity validated findings, reviewer coverage, important limitations, recommended first improvement, and the next interactive decision. State explicitly that no application code was changed.
