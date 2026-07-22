---
name: sdd-orphan-audit
description: Run a conservative SDD orphan and reverse-traceability audit for an application repo, one Epic, or a changed surface. Use when the user invokes /sdd-orphan-audit, asks to find orphaned tests, unused files, stale functions, dead code candidates, missing Epic references, stale Implemented By or Verified By evidence, files/tests not owned by any Epic, or SDD traceability drift across a project. Starts with current-working-tree and docs/epics evidence, optionally layers stack-specific analyzers when available, writes or prints a report, and never deletes or rewrites code automatically.
---

# SDD Orphan Audit

Find likely orphaned code/tests and SDD traceability gaps without brute-force reading the repo.

## Authority And Project Profile

Resolve the workspace and repository with `sdd context <relevant-path> --json`, then read the `workflowPath` returned by `sdd context` completely before classifying traceability or artifact-authority gaps. Enforce Epics under `docs/epics/`, changes under `docs/changes/`, and audit reports under `docs/audits/` inside the resolved repository. Project guidance owns source, generated-file, test, and analyzer conventions. If user setup is missing, direct the user to `sdd setup`; if the repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

This is a report-first audit. It can identify candidates, confidence levels, and recommended follow-up workflows, but it must not delete code, remove tests, rewrite Epics, or make cleanup commits unless the user explicitly asks for a separate follow-up change.

## Modes

- Default: run the universal audit, optionally run cheap stack-native inventory commands, write a dated report, and summarize findings.
- `--check`: read-only terminal output only. Do not write a report.
- `--json`: emit the universal script JSON when useful for further tooling.
- `--with-stack-tools`: after the universal pass, run installed stack-specific analyzers that are safe and local.
- `--epic <id-or-path>`: limit ownership evidence to one Epic while retaining a full current-working-tree candidate inventory.
- `--changed-from <ref>`: limit candidates to committed, staged, unstaged, and untracked files in the current source working surface since the ref.

## Output

Default report path:

```text
<app-root>/docs/audits/<yyyy-mm-dd>-orphan-audit.md
```

Use `assets/orphan-audit-report-template.md` when writing the report. Create `docs/audits/` only when writing a report.

The report is advisory. Address findings through `/sdd-change --brief`, `/sdd-change --plan`, `/sdd-interactive`, `/sdd-apply`, `/sdd-review`, or `/sdd-epic-verify` depending on the finding.

## Required Context

Before auditing, read:

- project-local `AGENTS.md`, especially branch policy and generated-file guidance
- parent or workspace guidance when the project points to it
- `docs/epics/*/epic.md`
- active and recent `docs/changes/**/{proposal.md,design.md,tasks.md,review.md}` only when they explain likely drift
- project README, test docs, package scripts, framework config, and configured release communication when they affect inventory or cleanup risk

Check git status before writing a report. Preserve unrelated dirty files. Do not stage, commit, push, merge, deploy, or mutate external services.

## Operating Sequence

1. Locate the application root.
   - Prefer an explicit path.
   - Otherwise use the nearest repo with `.git/`, `docs/epics/`, `docs/changes/`, `package.json`, or framework config.
   - Do not audit the whole workspace tree unless that tree is the intended target.
2. Run the universal traceability script.
   - Use `scripts/sdd_orphan_audit.py <app-root> --format markdown` for a human summary.
   - Use `--format json` when the result will be post-processed.
   - The script parses `docs/epics/*/epic.md`, extracts `Implemented By` and `Verified By` path-like references, preserves v2 implementation kinds such as `primary`, `adapter`, and `support`, expands globs, and compares them to the current working tree: tracked plus untracked files minus staged or unstaged deletions. It separates behavior-test/source candidates from likely test harness, framework/configuration, and generated support files. Human review must still decide whether every Requirement has the right primary owner, whether exclusions are project-appropriate, and whether `Verified By` is scenario-mapped rather than a broad command reference. File-level ownership is not symbol-level coverage: a file already cited for one behavior can still contain an unmapped governing symbol for another behavior.
   - Use `--epic` for Epic verification and combine `--epic` with `--changed-from` for Change-local apply/review checks. Run one Epic-scoped pass per affected Epic when a Change spans Epics.
3. Review the script output.
   - Read only suspicious files or artifacts needed to classify findings.
   - Do not read every source file by default.
   - Treat files not referenced by Epic evidence as traceability gaps first, not deletion candidates.
   - Classify each candidate against project conventions and runtime wiring. The script output is never deletion approval.
4. Optionally run stack-specific analyzers.
   - Only in `--with-stack-tools` mode or when the user explicitly asks.
   - Prefer installed, local, read-only analyzers. Examples: `knip`, `ts-prune`, `depcheck`, ESLint unused rules, `vulture`, `ruff`, coverage reports, framework route manifests, or language import graph tools.
   - Do not install new tools without asking.
   - Record analyzer command, version when easy, exit code, and limitations.
5. Classify findings.
   - `missing-reference`: Epic evidence points to a file/test that does not exist.
   - `traceability-gap`: a real file/test appears relevant but no Epic owns it in `Implemented By` or scenario-mapped `Verified By`.
   - `navigation-gap`: the Epic names participating files but does not identify a usable primary application-logic owner and stable symbol/searchable anchor for the Requirement.
   - `likely-orphan`: SDD evidence is absent and a stack analyzer or repo-native inventory suggests the item is unused.
   - `stale-test`: a test exists but appears to verify removed, renamed, or unowned behavior.
   - `stale-code`: code exists but appears unused or disconnected from current routes/build/runtime.
   - `inconclusive`: dynamic import, framework convention, generated file, plugin registration, reflection, CLI entrypoint, or insufficient evidence prevents a useful conclusion.
   - After refactors, explicitly search for stranded routes, registrations, imports, dependencies, tests, migrations, generated bindings, and obsolete files even when static ownership looks complete.
6. Recommend the next workflow.
   - Use `/sdd-epic-verify` when an Epic may be stale or missing evidence.
   - Use `/sdd-change --brief` for deferred cleanup outcomes and `/sdd-change --plan` for current Story moves, artifact corrections with implementation implications, or broad traceability repair.
   - Use `/sdd-interactive` for small, obvious traceability fixes or narrowly scoped cleanup.
   - Use `/sdd-apply` only when an active change already owns the cleanup.
   - Use `/sdd-review` when cleanup has been implemented and needs local PR-style validation.

## Confidence Rules

- `high`: missing referenced files, deleted paths, analyzer-confirmed unused items with no Epic evidence, or tests that no longer run.
- `medium`: no Epic evidence plus local static signals suggest unused or stale.
- `low`: no Epic evidence but dynamic usage, generated conventions, framework routing, or limited analyzer support may explain it.

Never equate "not referenced by an Epic" with "safe to delete." It may mean the Epic's `Implemented By` or `Verified By` evidence is incomplete.

## Stack-Specific Extension Points

Keep the base skill universal. Add stack-specific guidance later as references or scripts when repeated audits need it.

Possible future extensions:

- TypeScript/Next/Vite/Turborepo: `knip`, TypeScript project references, route manifests, test discovery, coverage.
- Python: `vulture`, `ruff`, pytest discovery, import graph tools, coverage.
- Convex: Convex function references, generated API clients, schema/function exports, deployment-safe checks.
- Plugin-heavy systems: explicit registration manifests, command registries, extension points, dynamic import allowlists.

## Report Shape

Include:

- app root and git root
- audit date
- commands run
- Epic evidence coverage summary
- missing Epic references
- tests without scenario-mapped `Verified By` ownership
- source files without `Implemented By` ownership
- implementation ownership by kind, including whether primary behavior owners are distinguishable from adapters and support
- stack analyzer findings, if any
- confidence-classified candidates
- false-positive risks
- recommended next workflows

Keep reports concise. Prefer top candidates and patterns over dumping every unreferenced file in large repos. Attach full JSON only when the user asks.

## Stop Conditions

Stop and report when:

- project selection is ambiguous.
- `docs/epics/` is missing and the user expected a SDD project.
- git status shows unrelated dirty files that overlap report output.
- analyzer commands would install packages, mutate caches in risky locations, rewrite files, contact production services, or require credentials.
- candidate cleanup depends on product, security, data, or architecture judgment.

## Final Response

Lead with result: `audit written`, `check complete`, `blocked`, or `no SDD evidence found`.

Include:

- report path, unless `--check`
- highest-signal findings by confidence
- commands run
- stack analyzers used or intentionally skipped
- recommended next workflow
- reminder that no deletion happened
