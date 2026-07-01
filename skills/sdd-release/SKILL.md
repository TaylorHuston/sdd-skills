---
name: sdd-release
description: Prepare a SDD application release PR to main or another production branch. Use when the user invokes /sdd-release, asks to release, push or promote to main, cut a release, prepare a production-branch PR, run full release checks, run the full e2e suite before release, bump or finalize CHANGELOG.md following Keep a Changelog, open a release pull request, or use remote CI / AI-assisted review for main promotion. Runs branch-policy and dirty-state preflight, verifies SDD review/readiness and closeout consistency, runs full e2e and other required release checks, updates CHANGELOG.md only after checks pass, commits release metadata, pushes the release branch when authorized by the PR request, and opens a PR to main/production. Does not merge, deploy, tag, or publish without explicit authorization.
---

# SDD Release

Prepare a release pull request to `main`.

This is the release gate after implementation and local review. It is stricter than `/sdd-review`: `/sdd-review` proves a change is ready; `/sdd-release` proves a release candidate is ready to ask `main` to accept it.

Use this as the default remote PR workflow for production-branch promotion. Routine SDD changes may be reviewed and merged locally into the project integration branch; `/sdd-release` is where hosted CI, review-thread history, and remote AI-assisted review become the default path.

## Modes

- Default: run release preflight, run full release checks including full e2e, update `CHANGELOG.md`, commit release metadata, push the release branch when needed, and open a PR to `main`.
- `--check`: run preflight and release checks only. Do not edit, commit, push, or open a PR.
- `--no-pr`: run release checks and update release artifacts, but stop before pushing or opening a PR.
- `--no-commit`: keep `CHANGELOG.md` and related release artifacts unstaged; report a commit candidate.
- `--target <branch>`: override target branch. Default to `main`, unless project-local branch policy names a different production branch.
- `--source <branch>`: override source branch. Default to the current branch when it is allowed by project branch policy.

Push, PR creation, tags, merge, deployment, package publish, production migrations, destructive data operations, and release announcements require explicit user authorization through the request or mode. A request to open a PR authorizes the push required to create that PR, but not merge or deploy.

## Required Context

Before release work, read:

- project-local `AGENTS.md`, especially branch policy and release rules
- parent/workspace `AGENTS.md` when the app lives under or beside the vault
- `developer-guide.md` from the vault root when available
- root `README.md`, package scripts, test docs, deployment docs, and CI docs when present
- remote review configuration such as `.coderabbit.yaml`, GitHub branch protection, or project docs when present
- root `CHANGELOG.md`
- active and recently completed `docs/changes/**/{proposal.md,design.md,tasks.md,review.md}` relevant to the release
- `docs/epics/*/epic.md` when release notes, changelog entries, or readiness depend on Epic truth
- project PRD/Product Brief when product scope changed or release contents are ambiguous

Check git status in every repo that may change. Preserve unrelated dirty files. Do not stage unrelated changes.

## Operating Sequence

1. Resolve release target.
   - Locate the application root.
   - Resolve source branch, target branch, remote, and PR base from explicit input and project branch policy.
   - Default target branch is `main`.
   - Stop if branch policy is missing or contradicts releasing to `main`.
   - Stop if the current branch is the target branch unless the project explicitly releases from a temporary release branch created from target.
2. Run release preflight.
   - Confirm the worktree is clean or only contains release-artifact edits that this skill will make.
   - Confirm source branch is up to date with target or record why not.
   - Check for merge conflicts with target without performing the merge.
   - Confirm no active SDD change required for this release is missing `/sdd-review` readiness or accepted override.
   - Confirm release-relevant active or closed SDD changes have consistent review records, manual confirmation status, changelog state, PR/merge state, accepted deferred gaps, and folder location.
   - Stop on duplicate Story IDs across active Epics unless the release is explicitly carrying the cleanup and it has already passed `/sdd-review`.
   - Confirm root `CHANGELOG.md` exists or create it from `assets/changelog-template.md` only when the project does not have one and the user wants release notes.
   - Confirm secrets, env files, generated caches, build artifacts, and local-only files will not be staged.
3. Run full release checks before changelog bump.
   - Run the full e2e test suite first when the project exposes a clear e2e command.
   - Also run required release checks from project docs or package scripts, such as lint, typecheck, unit tests, integration tests, build, codegen check, migration dry-run/check, formatting check, or docs validation.
   - Prefer project-defined aggregate commands such as `test`, `test:e2e`, `e2e`, `ci`, `check`, `lint`, `typecheck`, and `build`; do not invent destructive commands.
   - If no e2e command exists, stop or explicitly record why the release cannot satisfy the normal gate.
   - If any required release check fails, stop before changelog edits unless the failure is caused by stale release metadata and the project policy permits fixing it first.
4. Prepare the changelog.
   - Follow Keep a Changelog 1.1.0.
   - Keep `Unreleased` first.
   - Move release-ready `Unreleased` entries into a new version/date heading only when the project uses versioned releases or the user provides the release version.
   - If no release version is known, keep entries under `Unreleased` and add a release PR note rather than inventing a semantic version.
   - Use the local shell date in ISO format for dated release headings.
   - Keep categories to `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
   - Ensure entries are public-safe: no private vault context, SDD ledger details, raw Requirement/Scenario lists, secrets, internal-only task IDs, or speculative roadmap promises.
   - Verify the changelog matches the SDD changes intended for the release.
5. Rerun release checks affected by changelog or release-artifact edits.
   - At minimum, rerun any docs/changelog validation if present.
   - Rerun full e2e only when release-artifact edits can affect runtime, build, packaged assets, or the project policy requires it after any commit.
6. Commit release metadata when allowed.
   - Stage only `CHANGELOG.md` and other explicit release artifacts.
   - Use a concise commit message such as `Prepare release notes`.
   - Skip committing in `--check` and `--no-commit`.
7. Open the release PR.
   - Push the source branch only when PR creation is authorized.
   - Open a PR from source to target using `gh`, GitHub tools, or the project-approved tool.
   - Use `assets/release-pr-template.md` for the PR body.
   - Include release scope, changelog summary, SDD reviews checked, commands run, full e2e result, security/data notes, manual acceptance notes, and known risks.
   - Treat the remote PR as the handoff to hosted CI and remote AI-assisted review when configured. Add required labels, reviewers, or context only when project docs or the user's request calls for them.
   - Record remote AI-assisted review as `triggered`, `not configured`, `unavailable`, or `not checked`; do not block PR creation solely because an optional remote review has not completed.
   - Do not merge the PR unless the user explicitly asked for release merge and branch policy allows it.
8. Update SDD artifacts when appropriate.
   - If release readiness changes active `tasks.md` closeout state, update it only when the release clearly owns that change and the update is safe.
   - Do not close change folders unless the user explicitly asks or the release workflow is authorized to close completed changes.
9. Report release state.

## Recommended Gates

In addition to full e2e, prefer these gates when the app exposes them:

- lint
- typecheck
- unit tests
- integration tests
- build
- migration/schema/codegen check
- security-sensitive configuration review
- dependency/lockfile review
- changelog validation
- source-vs-target conflict check
- CI status check after PR creation when available
- remote AI-assisted code review status after PR creation when configured

Scale to the app. A small static app may only have build plus e2e. A multi-app system should use the app's full documented release gate.

## Changelog Rules

Treat `CHANGELOG.md` as public release communication.

- Use Keep a Changelog 1.1.0 conventions.
- Do not create release versions from guesses.
- If the project has `package.json` versioning and the user wants a version bump, ask for the release type or infer only from an explicit project convention.
- If there are no public-facing changes, record that in the release PR rather than fabricating changelog content.
- If `Unreleased` is empty but SDD changes were released, inspect the relevant changes and Epics before adding entries.

## Stop Conditions

Stop and report when:

- branch policy is missing, unclear, or conflicts with the requested release route.
- source or target branch selection is ambiguous.
- unrelated dirty files would be staged or affect release checks.
- full e2e does not exist, cannot run, or fails.
- required release checks fail.
- `/sdd-review` readiness is missing for release-blocking SDD changes.
- release-relevant SDD closeout state is contradictory or duplicate Story IDs make Epic traceability unreliable.
- `CHANGELOG.md` is missing and the user has not authorized creating one.
- changelog content would require a product or release-version decision.
- release requires secrets, production data, migrations, deploys, tags, package publishing, or external service changes not explicitly authorized.
- push or PR creation is not authorized by the request or mode.

## Final Response

Lead with result: `release PR opened`, `ready but PR not opened`, `checks failed`, or `blocked`.

Include:

- app root
- source branch and target branch
- PR URL when created
- release checks run and results, with full e2e called out
- changelog action taken
- release commit hash or commit candidate
- SDD review/readiness status
- remote CI and AI-assisted review status when known
- remaining risks or approvals needed
- exact next action

End with a concise self-improvement conclusion: ask "How well did this work, and what could have been improved?" and name one process improvement if evident.
