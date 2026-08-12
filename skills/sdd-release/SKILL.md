---
name: sdd-release
description: Prepare coordinated SDD release handoffs to project-defined production targets. Use when the user invokes /sdd-release, asks to release, promote, cut a release, run release checks, review a changelog, prepare required release communication or version metadata, suggest a version increment, or open production PRs. Runs branch-policy and dirty-state preflight across every target repository, verifies SDD review/readiness and Change-wide closeout consistency, reviews changelog contents, confirms version intent, and creates the configured handoffs without merging or deploying.
---

# SDD Release

Prepare a release handoff to the project-defined production target.

## Authority And Project Profile

Resolve the workspace installation, Space, one central Change, idea-owned planning path, and every target repository named by the Change with `sdd context <relevant-path> --json` and `sdd status <space-id> --json`, then read the `workflowPath` returned by `sdd context` completely before judging SDD readiness, evidence, reconciliation, or reviewed-commit freshness. Resolve each repository's production target, source policy, release mechanism, required checks, versioning, release-note format, hosting provider, and handoff independently while keeping one central ledger at `<workspace>/.sdd/changes/`.

This is the release gate after implementation and local review. It is stricter than `/sdd-review`: `/sdd-review` proves technical readiness while recording manual acceptance separately; `/sdd-release` proves that the complete coordinated candidate set satisfies every repository-specific and aggregate technical, acceptance, and handoff gate for the production targets.

Use this for production-target promotion after local implementation and review. Each target repository's project profile decides whether its handoff is a pull request, another review mechanism, or a local release process.

After `/sdd-release` opens the release PR set, use `/sdd-pr` for ongoing stewardship of every PR: checking review comments, status checks, review threads, remote AI-assisted feedback, narrow accepted fixes, replies, and final merge-readiness handoff. `/sdd-release` prepares the coordinated handoff set; `/sdd-pr` tends it until the user approves each merge.

## Modes

- Default: run aggregate and repository-specific release preflight, run every target repository's project-defined release gate, update and commit required release artifacts, make one normal push of each resolved source branch, and create every configured release PR or equivalent non-production handoff after all Change-wide and repository-specific gates pass.
- `--check`: run preflight and release checks only. Do not edit, commit, push, or open a PR.
- `--no-pr`: run release checks and update release artifacts, but stop before pushing or opening a PR.
- `--no-commit`: keep `CHANGELOG.md` and related release artifacts unstaged; report a commit candidate.
- `--target <branch>`: override the target for a one-repository release. For multiple repositories, require unambiguous repository-qualified overrides or use each repository's project policy.
- `--source <branch>`: override the source for a one-repository release. For multiple repositories, require unambiguous repository-qualified overrides or use each allowed current branch.

A default or explicit full `/sdd-release` invocation, or an unqualified request to release, promote, or cut a release, is explicit scoped authorization for policy-compliant release-metadata commits, one non-force push of each resolved source branch to its configured remote, and creation of every configured release PR or equivalent handoff once release, acceptance, version-decision, and cross-repository coordination gates pass. This workflow authorization satisfies a project rule requiring user authorization for those ordinary source pushes and PRs unless project-local policy explicitly requires a separate just-in-time confirmation. Do not ask again merely because a resolved source branch has not been pushed yet.

`--check`, `--no-pr`, an explicitly checks-only request, an explicit no-push/no-PR instruction, or stricter project-local policy removes that handoff authorization. Default authorization never permits a force-push, pushing a different branch or any production target directly, merge, tag, deployment, package publish, production migration, destructive data operation, release announcement, or branch deletion. Those actions require separate explicit authorization.

## Required Context

Before release work, read:

- project-local `AGENTS.md`, especially branch policy and release rules
- parent/workspace guidance when the project points to it
- root `README.md`, package scripts, test docs, deployment docs, and CI docs when present
- remote review, branch-protection, or release-provider configuration when present
- each target repository's `CHANGELOG.md` when present, plus its project-defined changelog, release notes, version metadata, or release manifest when different or otherwise required
- the release-relevant central Change records selected from top-level `sdd status <space-id> --json` output, reading `change.md`, `design.md`, `tasks.md`, and `review.md` from their canonical `<workspace>/.sdd/changes/**` locations without copying workspace-local paths into public release artifacts
- relevant Epic files from each owning repository's configured Epic path when release notes, changelog entries, or readiness depend on Epic truth
- project PRD/Product Brief when product scope changed or release contents are ambiguous
- project visual/style guidance or app visual identity docs when a release includes prominent UI, layout, branding, or app-identity changes and those docs affect release risk or communication

Check git status in every repo that may change. Preserve unrelated dirty files. Do not stage unrelated changes.

## Operating Sequence

1. Resolve the complete release target set.
   - Derive the stable target repository IDs from each selected central Change and resolve every current repository root.
   - Resolve source branch, target branch, remote, PR base, release mechanism, and ordering constraints independently for every repository from explicit input and project branch policy.
   - Do not infer one repository's production target or branch pair from another. Stop if any required target is ambiguous or unavailable.
   - Stop if any current branch is its production target unless that repository explicitly releases from a temporary release branch created from target.
   - Record the full repository handoff set before running checks; a passing target never makes the aggregate release ready by itself.
2. Run release preflight.
   - Confirm every target worktree is clean or only contains release-artifact edits that this skill will make.
   - Confirm each source branch is up to date with its own target or record why not.
   - Check every source/target pair for merge conflicts without performing a merge.
   - Confirm no active SDD change required for this release is missing `/sdd-review` readiness or accepted override.
   - Confirm each release-relevant active Change has a valid central `change.md` status and is `in_review` with a passing review record when release handling is the last remaining transition. A central record under `<workspace>/.sdd/changes/closed/` is closed regardless of its retained active status value.
   - Confirm release-relevant active or closed SDD changes have consistent review records, manual confirmation status, release-communication state, PR/merge state, accepted deferred gaps, and folder location.
   - Distinguish technical review readiness from manual acceptance. Resolve whether project policy permits the configured release handoff while confirmation is `pending user`; if not, stop with the prepared walkthrough. Never report full release readiness, merge, deploy, close, or perform another acceptance-dependent action until required confirmation is `user confirmed` or recorded as an accepted gap.
   - Perform a cumulative source-vs-target release risk scan. Require a fresh-context cumulative release-candidate code/security/state review of the exact combined diff for an initial production release, multiple integrated Changes, material post-review work, or a cumulative diff that crosses auth/credentials, filesystem confinement, plugins/capabilities, AI tools or provider-visible content, concurrency/recovery, persistence/migrations, or another high-risk shared boundary. Apply the relevant `/sdd-review` code, boundary-contract, state-transition, security/data-safety, evidence, and integration gates without reopening individual Change lifecycle or repeating unaffected artifact review. Existing per-Change reviews are inputs, not a substitute for this triggered cumulative review. For an ordinary single-Change low-risk release, the proportional cumulative scan is sufficient. Record the exact reviewed release-candidate commit, reviewer/context, gates, result, and accepted gaps. If a release-critical claim lacks proof or the cumulative review finds unresolved risk, stop or route back to `/sdd-review` or `/sdd-apply`.
   - Stop on duplicate `S#` Story labels inside one Epic, duplicate full Story references, or conflicting legacy app-wide Story IDs unless the release is explicitly carrying the cleanup and it has already passed `/sdd-review`.
   - Confirm every project-required release record exists. Create a missing record from a compatible template only when project policy or the user authorizes that format.
   - Confirm secrets, env files, generated caches, build artifacts, and local-only files will not be staged.
   - Build an exact source-to-target changed-file inventory in every target repository before editing release metadata. Classify every path as intended product scope, required SDD/supporting truth, authorized release metadata, generated output required by project policy, or unrelated. Record repository-keyed release allowlists and cross-repository compatibility or sequencing gates; stop on any unexplained path or missing target.
3. Resolve and run release checks before release-artifact edits.
   - First defer to project-local release guidance when it exists, in this order: project-local `AGENTS.md`, `docs/ci-cd.md`, `docs/testing.md`, `docs/deployment.md`, workflow files under `.github/workflows/`, then package scripts.
   - Treat the project-local documented required release gate as authoritative when it clearly names required commands or explicitly marks browser, provider-backed, deployment, or e2e checks as optional, risk-triggered, or not required yet.
   - Run the full e2e test suite first only when project-local docs or scripts expose it as required for release, or when release risk makes browser/provider-backed verification materially necessary.
   - Also run required or best-available release checks from project docs or package scripts, such as lint, typecheck, unit tests, integration tests, build, codegen check, migration dry-run/check, formatting check, docs validation, or risk-triggered e2e.
   - Prefer project-defined aggregate commands such as `ci:required`, `ci`, `check`, `test`, `test:e2e`, `e2e`, `lint`, `typecheck`, and `build`; do not invent destructive commands.
   - Run each required release gate freshly on that repository's exact current committed source candidate and record meaningful constituent/test counts or equivalent execution evidence plus cache treatment. Run required cross-repository compatibility or integration gates against the exact coordinated candidate set. Per-Change focused evidence, a closed Change, structural SDD validation, or CI for another repository or ref never substitutes for current candidate proof.
   - If no project-local release guidance exists, derive the strongest available local release gate from package scripts, workflow files, README/testing docs, and the changed risk surface. Do not require e2e solely because the project exposes an e2e command.
   - If no project-local release guidance exists and no meaningful local release gate can be identified, stop or explicitly record why release confidence cannot be established.
   - If project-local release guidance exists and says e2e or browser/provider checks are optional or not yet part of the required gate, do not stop solely because no e2e command exists; report the skipped optional gate and its documented reason.
   - If any required release check fails, stop before release-artifact edits unless the failure is caused by stale release metadata and project policy permits fixing it first.
4. Review the changelog and confirm version intent.
   - Read the complete unreleased section and the latest released entry in `CHANGELOG.md` when present. Compare them with the source-vs-target diff, release-relevant SDD Changes, and the project's configured release record so omissions, duplicate claims, stale entries, internal bookkeeping, and unverified claims are visible before release metadata changes.
   - Resolve the current version and the project's versioning policy from manifests, version files, documented tooling, release records, and tags as project policy permits. Do not infer a scheme the project has not adopted.
   - Suggest the next version under the configured policy. For Semantic Versioning, normally suggest `major` for breaking public behavior or compatibility requirements, `minor` for backward-compatible user-facing capabilities, and `patch` for backward-compatible fixes, security hardening, or public operational/documentation corrections. Account for explicit pre-1.0 or project-specific rules. If the changelog contains no version-worthy public change, recommend no bump instead of manufacturing one.
   - Present the current version, suggested next version and increment class, concise changelog summary, rationale, and any ambiguity. Then explicitly ask whether the user wants this release to be a version update before changing a version, converting an unreleased section into a released version, planning a tag/package release, or describing the handoff as versioned.
   - Offer the suggested version, a different version, or no version update when project policy permits. An explicit version supplied by the user, or an explicit instruction to release as that version, already satisfies this confirmation; a general request to run `/sdd-release` does not.
   - In `--check`, do not pause for confirmation or mutate artifacts. Report the recommendation, whether a version update appears appropriate, and the confirmation that a later non-check run would require.
   - If no changelog exists, record that fact and follow the configured release-record policy. Do not create a changelog or invent versioning merely to satisfy this workflow.
5. Prepare release communication and version metadata.
   - Follow the project's configured release-record and the user's confirmed version decision. Do not impose a changelog format or version scheme when none is configured.
   - Use the confirmed user-provided or user-approved version, then apply project-owned version tooling or documented rules. Stop when the chosen version is incompatible with project policy or required version metadata remains ambiguous.
   - Update the configured manifest, lockfile, changelog, release note, changeset, tag plan, or equivalent artifacts together when project policy requires them.
   - When the project uses Keep a Changelog, apply that format through `assets/changelog-template.md`; otherwise preserve the project's native structure.
   - Keep public release communication user-facing and public-safe. Exclude private planning context, SDD ledger detail, secrets, internal task IDs, speculative roadmap promises, and implementation bookkeeping unless project policy explicitly requires technical release notes.
   - Verify release communication matches the SDD changes intended for this release and does not claim unverified behavior.
6. Rerun release checks affected by release-artifact edits.
   - At minimum, rerun any release-record or documentation validation if present.
   - Rerun full e2e only when release-artifact edits can affect runtime, build, packaged assets, or the project policy requires it after any commit.
7. Commit release metadata when allowed.
   - Stage only the explicit release artifacts resolved from each repository's policy.
   - Compare each repository's staged file list to its release-metadata allowlist immediately before committing. Unstage and classify any unexpected path; never rely on an earlier clean-status observation.
   - Use a concise project-compatible commit message such as `Prepare release notes`.
   - After committing, compare each committed name-status list to the same repository allowlist before any push.
   - Skip committing in `--check` and `--no-commit`.
8. Open the release handoff set.
   - In default/full mode, treat the invoked workflow as authorization to push each resolved source branch normally and create every configured release PR. Do not pause for a second authorization after the version decisions and aggregate release gates are complete unless a repository's policy explicitly requires it.
   - Immediately before each push, recompute that repository's complete source-to-target diff and compare it path-for-path with the recorded release allowlist for that repository. Confirm every addition, deletion, rename, and modification has one current classification; stop the aggregate handoff on an unexpected or reclassified path.
   - Confirm every source `HEAD` is the exact reconciled candidate recorded in the handoff set, all required repository-specific and cross-repository checks passed against the coordinated candidates, no intended release work remains uncommitted, every remote and upstream is the resolved one, and each push is non-force. Stop on drift instead of pushing a different candidate.
   - Push only the resolved source branches; never use this authorization to push a production target, another branch, tags, or rewritten history.
   - Open or prepare each project-defined release handoff using the configured provider and available tools.
   - Use `assets/release-pr-template.md` as the aggregate contract. Repeat its repository bundle for every target; when separate PRs are required, put the owning repository bundle and aggregate coordination state in each PR body.
   - Record every repository ID, source/target refs, exact candidate commit, reconciled file classifications, excluded paths, release communication, SDD review, cumulative-review decision, verification commands/results, security/data notes, manual acceptance, remote review watermarks, PR URL/state, and known risks. Record cross-repository compatibility, ordering, and shared-candidate evidence separately.
   - Treat each remote PR as its repository's handoff to hosted CI and remote AI-assisted review when configured. Add required labels, reviewers, or context only when project docs or the user's request calls for them.
   - Initialize repository-keyed Remote Review Watermarks for every configured human, AI-assisted reviewer, or status check. Required remote review may remain pending at PR creation but cannot be treated as merge-ready; optional unavailable review must be classified explicitly.
   - End new PR creation with a handoff to `/sdd-pr` for stewardship of the complete PR set after CI, bots, or humans have had time to respond.
   - Do not merge any PR unless the user explicitly asked for that release merge and the owning repository's branch policy allows it.
9. Update SDD artifacts when appropriate.
   - If release readiness changes closeout evidence, update the one central `tasks.md` with repository-keyed release, PR, merge, acceptance, and accepted-gap state. Do not independently change a target repository's lifecycle.
   - Do not close the central Change unless the user explicitly asks or the release workflow is authorized to close it after every target repository passes.
   - When closeout is authorized and every release-owned contextual gate passes across the full target set, use `sdd change close <space-id> <change-id> --workspace <workspace-root>` once, with no `--repo`, instead of moving the folder manually. Do not treat the CLI preflight as a substitute for release or merge readiness.
10. Report release state.

## Recommended Gates

Use each target repository's documented release gate first. Also prefer these gates when that repository exposes them and project-local policy does not mark them optional for the current release:

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
- remote reviewer/check watermarks against the current PR head when the provider exposes them

Scale independently to each target. A small static app may only have build. A local MVP may intentionally keep browser or provider-backed checks optional until they are stable and cheap. A multi-repository release must preserve every repository's documented gate plus required cross-repository compatibility or ordering proof.

## Release Communication Rules

- Treat the project-defined release record as public communication unless local guidance says it is private.
- Do not reuse an already released version or release identifier for new content.
- Do not infer a versioning scheme that the project has not adopted.
- Review unreleased changelog content against the actual release scope before recommending a version.
- Do not convert unreleased content into a numbered release or modify version metadata until the user confirms the version-update decision.
- Include only the content required by project policy, and keep every behavior claim aligned with current Epic truth and evidence.
- If there are no public-facing changes, say so in the configured handoff instead of fabricating release notes.

## Stop Conditions

Stop and report when:

- any target repository's branch policy is missing, unclear, or conflicts with the requested release route.
- any source or target branch selection is ambiguous.
- unrelated dirty files in any target would be staged or affect release checks.
- project-local release guidance requires full e2e and it does not exist, cannot run, or fails.
- no project-local release guidance exists and no meaningful local release gate can be identified or satisfied.
- required release checks fail.
- `/sdd-review` readiness is missing for release-blocking SDD changes.
- a triggered cumulative release-candidate review is missing, stale, or has unresolved findings for an initial, multi-Change, materially post-review, or high-risk cumulative release diff.
- required manual confirmation remains `pending user` and project policy requires acceptance before the configured release handoff or requested release action.
- release-relevant SDD closeout state is contradictory, duplicate Story labels/references make Epic traceability unreliable, or conflicting legacy app-wide Story IDs are unresolved.
- a required release record is missing and the user or project policy has not authorized creating one.
- release communication or version metadata requires an unresolved product or release decision.
- the version-update decision or exact version remains unconfirmed after the changelog review and the next action would mutate versioned release artifacts or describe the handoff as a versioned release.
- release requires secrets, production data, migrations, deploys, tags, package publishing, or external service changes not explicitly authorized.
- the request is checks-only, `--no-pr`, explicitly forbids push/PR creation, or project-local policy explicitly requires separate confirmation for the ordinary source push or PR.

## Final Response

Lead with result: `release PR set opened`, `ready but handoff not opened`, `checks failed`, or `blocked`.

Include:

- complete target repository ID/root set
- repository-keyed source branches, target branches, and exact candidate commits
- every PR or equivalent handoff URL when created
- repository-specific and cross-repository release checks and results, with full e2e called out where applicable
- release-communication action taken by repository
- changelog review summary, current version, suggested increment and version, user-confirmed version decision, and rationale by repository or shared release train
- release commit hashes or commit candidates by repository
- aggregate and repository-specific SDD review/readiness status
- cumulative release-candidate review triggers, exact commits/trees, gates, and results
- manual confirmation status and whether acceptance permits each configured handoff and any later merge, deployment, or Change-wide closeout
- repository-keyed remote reviewer/check watermarks and required-versus-optional status when known
- whether `/sdd-pr` should be rerun later to steward the complete opened PR set
- remaining risks or approvals needed
- exact next action
