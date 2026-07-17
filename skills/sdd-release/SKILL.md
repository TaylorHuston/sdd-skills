---
name: sdd-release
description: Prepare a SDD application release handoff to the project-defined production target. Use when the user invokes /sdd-release, asks to release, promote, cut a release, run release checks, prepare required release communication or version metadata, or open the policy-defined production PR or equivalent handoff. Runs branch-policy and dirty-state preflight, verifies SDD review/readiness and closeout consistency, follows project-local release gates and release-record conventions, commits authorized release metadata, and opens or prepares the configured handoff. Does not merge, deploy, tag, publish, or mutate production state without explicit authorization.
---

# SDD Release

Prepare a release handoff to the project-defined production target.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and target implementation repository with `sdd context <relevant-path> --json`, then read `<workspaceRoot>/.sdd/story-driven-development.md` completely before judging SDD readiness, evidence, reconciliation, or reviewed-commit freshness. Use the resolved topology unless project guidance declares an explicit exception, then resolve the production target, source policy, release mechanism, required checks, versioning, release-note format, hosting provider, and permissions from project guidance. Read SDD Epics and changes from the canonical repository `docs/` layout inside the selected implementation repository; branch names and release artifacts remain project-specific. If the managed workflow document is missing, stop and direct the user to `sdd init` or `sdd doctor`.

This is the release gate after implementation and local review. It is stricter than `/sdd-review`: `/sdd-review` proves technical readiness while recording manual acceptance separately; `/sdd-release` proves that the complete release candidate satisfies the project-defined technical, acceptance, and handoff gates for the production target.

Use this for production-target promotion after local implementation and review. The project profile decides whether that handoff is a pull request, another review mechanism, or a local release process.

After `/sdd-release` opens a PR, use `/sdd-pr` for ongoing PR stewardship: checking review comments, status checks, review threads, remote AI-assisted feedback, narrow accepted fixes, replies, and final merge-readiness handoff. `/sdd-release` prepares the release PR; `/sdd-pr` tends that PR until the user approves merge.

## Modes

- Default: run release preflight, run the project-defined release gate, update required release artifacts, commit authorized release metadata, and perform the configured handoff.
- `--check`: run preflight and release checks only. Do not edit, commit, push, or open a PR.
- `--no-pr`: run release checks and update release artifacts, but stop before pushing or opening a PR.
- `--no-commit`: keep `CHANGELOG.md` and related release artifacts unstaged; report a commit candidate.
- `--target <branch>`: override the target resolved from project policy.
- `--source <branch>`: override source branch. Default to the current branch when it is allowed by project branch policy.

Push, PR creation, tags, merge, deployment, package publish, production migrations, destructive data operations, and release announcements require explicit user authorization through the request or mode. A request to open a PR authorizes the push required to create that PR, but not merge or deploy.

## Required Context

Before release work, read:

- project-local `AGENTS.md`, especially branch policy and release rules
- parent/workspace guidance when the project points to it
- root `README.md`, package scripts, test docs, deployment docs, and CI docs when present
- remote review, branch-protection, or release-provider configuration when present
- the project-defined changelog, release notes, version metadata, or release manifest when required
- active and recently completed `docs/changes/**/{proposal.md,design.md,tasks.md,review.md}` relevant to the release
- `docs/epics/*/epic.md` when release notes, changelog entries, or readiness depend on Epic truth
- project PRD/Product Brief when product scope changed or release contents are ambiguous
- project visual/style guidance or app visual identity docs when a release includes prominent UI, layout, branding, or app-identity changes and those docs affect release risk or communication

Check git status in every repo that may change. Preserve unrelated dirty files. Do not stage unrelated changes.

## Operating Sequence

1. Resolve release target.
   - Locate the application root.
   - Resolve source branch, target branch, remote, and PR base from explicit input and project branch policy.
   - Do not infer a production target from another project. Stop if project policy and explicit input do not identify one safely.
   - Stop if the current branch is the target branch unless the project explicitly releases from a temporary release branch created from target.
2. Run release preflight.
   - Confirm the worktree is clean or only contains release-artifact edits that this skill will make.
   - Confirm source branch is up to date with target or record why not.
   - Check for merge conflicts with target without performing the merge.
   - Confirm no active SDD change required for this release is missing `/sdd-review` readiness or accepted override.
   - Confirm each release-relevant active Change has a valid `tasks.md` status and is `in_review` with a passing review record when release handling is the last remaining transition. A folder under `docs/changes/closed/` is closed regardless of its retained active status value.
   - Confirm release-relevant active or closed SDD changes have consistent review records, manual confirmation status, release-communication state, PR/merge state, accepted deferred gaps, and folder location.
   - Distinguish technical review readiness from manual acceptance. Resolve whether project policy permits the configured release handoff while confirmation is `pending user`; if not, stop with the prepared walkthrough. Never report full release readiness, merge, deploy, close, or perform another acceptance-dependent action until required confirmation is `user confirmed` or recorded as an accepted gap.
   - Perform a cumulative source-vs-target release risk scan. Do not re-run full `/sdd-review`, but check whether the combined release diff contains important deterministic claims that local reviews only asserted, such as reset completeness, stable editable-state identity, async write ordering, parser/extractor rejection, remote/config failure behavior, or portable tooling assumptions. If a release-critical claim lacks proof or an accepted gap, stop or route back to `/sdd-review` or `/sdd-apply`.
   - Stop on duplicate `S#` Story labels inside one Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs unless the release is explicitly carrying the cleanup and it has already passed `/sdd-review`.
   - Confirm every project-required release record exists. Create a missing record from a compatible template only when project policy or the user authorizes that format.
   - Confirm secrets, env files, generated caches, build artifacts, and local-only files will not be staged.
3. Resolve and run release checks before release-artifact edits.
   - First defer to project-local release guidance when it exists, in this order: project-local `AGENTS.md`, `docs/ci-cd.md`, `docs/testing.md`, `docs/deployment.md`, workflow files under `.github/workflows/`, then package scripts.
   - Treat the project-local documented required release gate as authoritative when it clearly names required commands or explicitly marks browser, provider-backed, deployment, or e2e checks as optional, risk-triggered, or not required yet.
   - Run the full e2e test suite first only when project-local docs or scripts expose it as required for release, or when release risk makes browser/provider-backed verification materially necessary.
   - Also run required or best-available release checks from project docs or package scripts, such as lint, typecheck, unit tests, integration tests, build, codegen check, migration dry-run/check, formatting check, docs validation, or risk-triggered e2e.
   - Prefer project-defined aggregate commands such as `ci:required`, `ci`, `check`, `test`, `test:e2e`, `e2e`, `lint`, `typecheck`, and `build`; do not invent destructive commands.
   - If no project-local release guidance exists, derive the strongest available local release gate from package scripts, workflow files, README/testing docs, and the changed risk surface. Do not require e2e solely because the project exposes an e2e command.
   - If no project-local release guidance exists and no meaningful local release gate can be identified, stop or explicitly record why release confidence cannot be established.
   - If project-local release guidance exists and says e2e or browser/provider checks are optional or not yet part of the required gate, do not stop solely because no e2e command exists; report the skipped optional gate and its documented reason.
   - If any required release check fails, stop before release-artifact edits unless the failure is caused by stale release metadata and project policy permits fixing it first.
4. Prepare release communication and version metadata.
   - Follow the project's configured release-record and versioning policy. Do not impose a changelog format or version scheme when none is configured.
   - Use an explicit user-provided version first, then project-owned version tooling or documented inference rules. Stop when the version is ambiguous; do not invent a scheme.
   - Update the configured manifest, lockfile, changelog, release note, changeset, tag plan, or equivalent artifacts together when project policy requires them.
   - When the project uses Keep a Changelog, apply that format through `assets/changelog-template.md`; otherwise preserve the project's native structure.
   - Keep public release communication user-facing and public-safe. Exclude private planning context, SDD ledger detail, secrets, internal task IDs, speculative roadmap promises, and implementation bookkeeping unless project policy explicitly requires technical release notes.
   - Verify release communication matches the SDD changes intended for this release and does not claim unverified behavior.
5. Rerun release checks affected by release-artifact edits.
   - At minimum, rerun any release-record or documentation validation if present.
   - Rerun full e2e only when release-artifact edits can affect runtime, build, packaged assets, or the project policy requires it after any commit.
6. Commit release metadata when allowed.
   - Stage only the explicit release artifacts resolved from project policy.
   - Use a concise commit message such as `Prepare release notes`.
   - Skip committing in `--check` and `--no-commit`.
7. Open the release PR.
   - Push the source branch only when PR creation is authorized.
   - Open or prepare the project-defined release handoff using the configured provider and available tools.
   - Use `assets/release-pr-template.md` for the PR body.
   - Include release scope, release-communication summary, SDD reviews checked, the exact reviewed source commit, the initial reconciled PR head, post-review change classifications or `none`, commands run, relevant end-to-end results, security/data notes, manual acceptance notes, and known risks.
   - Treat the remote PR as the handoff to hosted CI and remote AI-assisted review when configured. Add required labels, reviewers, or context only when project docs or the user's request calls for them.
   - Record remote AI-assisted review as `triggered`, `not configured`, `unavailable`, or `not checked`; do not block PR creation solely because an optional remote review has not completed.
   - End new PR creation with a handoff to `/sdd-pr` for later review-thread and status-check stewardship after CI, bots, or humans have had time to respond.
   - Do not merge the PR unless the user explicitly asked for release merge and branch policy allows it.
8. Update SDD artifacts when appropriate.
   - If release readiness changes active `tasks.md` closeout state, update its machine-readable status consistently, using only `proposed`, `planned`, `in_progress`, or `in_review`, and only when the release clearly owns that change and the update is safe.
   - Do not close change folders unless the user explicitly asks or the release workflow is authorized to close completed changes.
   - When closeout is authorized and every release-owned contextual gate passes, use `sdd change close <space-id> <change-id> --repo <resolved-repository-path> --workspace <workspace-root>` instead of moving the folder manually. Do not treat the CLI preflight as a substitute for release or merge readiness.
9. Report release state.

## Recommended Gates

Use the app's documented release gate first. In addition, prefer these gates when the app exposes them and project-local policy does not mark them optional for the current release:

- lint
- typecheck
- unit tests
- integration tests
- build
- migration/schema/codegen check
- security-sensitive configuration review
- dependency/lockfile review
- release-record validation
- source-vs-target conflict check
- CI status check after PR creation when available
- remote AI-assisted code review status after PR creation when configured

Scale to the app. A small static app may only have build. A local MVP may intentionally keep browser or provider-backed checks optional until they are stable and cheap. A multi-app system should use the app's full documented release gate.

## Release Communication Rules

- Treat the project-defined release record as public communication unless local guidance says it is private.
- Do not reuse an already released version or release identifier for new content.
- Do not infer a versioning scheme that the project has not adopted.
- Include only the content required by project policy, and keep every behavior claim aligned with current Epic truth and evidence.
- If there are no public-facing changes, say so in the configured handoff instead of fabricating release notes.

## Stop Conditions

Stop and report when:

- branch policy is missing, unclear, or conflicts with the requested release route.
- source or target branch selection is ambiguous.
- unrelated dirty files would be staged or affect release checks.
- project-local release guidance requires full e2e and it does not exist, cannot run, or fails.
- no project-local release guidance exists and no meaningful local release gate can be identified or satisfied.
- required release checks fail.
- `/sdd-review` readiness is missing for release-blocking SDD changes.
- required manual confirmation remains `pending user` and project policy requires acceptance before the configured release handoff or requested release action.
- release-relevant SDD closeout state is contradictory, duplicate Story labels/references make Epic traceability unreliable, or conflicting legacy app-wide Story IDs are unresolved.
- a required release record is missing and the user or project policy has not authorized creating one.
- release communication or version metadata requires an unresolved product or release decision.
- release requires secrets, production data, migrations, deploys, tags, package publishing, or external service changes not explicitly authorized.
- push or PR creation is not authorized by the request or mode.

## Final Response

Lead with result: `release PR opened`, `ready but PR not opened`, `checks failed`, or `blocked`.

Include:

- app root
- source branch and target branch
- PR URL when created
- release checks run and results, with full e2e called out
- release-communication action taken
- release commit hash or commit candidate
- SDD review/readiness status
- manual confirmation status and whether acceptance permits the configured handoff and any later merge, deployment, or closeout
- remote CI and AI-assisted review status when known
- whether `/sdd-pr` should be rerun later to steward the opened PR
- remaining risks or approvals needed
- exact next action
