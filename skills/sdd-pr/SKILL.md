---
name: sdd-pr
description: Use when the user invokes /sdd-pr or asks to open, manage, review, or steward a pull request for SDD-backed work according to project branch and review policy. Creates a PR through the configured provider when one does not exist, and on later activations checks comments, requested changes, status checks, and review threads; addresses accepted feedback; reconciles post-review changes into Epic truth; preserves review freshness against the current PR head; and asks the user to approve the actual merge only after the loop is clean. Use /sdd-release first for production release handoff preparation and /sdd-pr afterward when that handoff is a PR.
---

# SDD PR

Open and steward the coordinated pull request set for every repository targeted by one central SDD Change. A one-repository Change has one PR; a multi-repository Change may require one PR per target repository, but all PRs share the one central lifecycle and evidence ledger.

## Authority And Project Profile

Resolve the user installation, Space, one central Change, and every target repository with `sdd context <relevant-path> --json`; use `sdd status <space-id> --json` when Change selection is needed, and read the `workflowPath` returned by `sdd context` completely before judging reconciliation, evidence, review freshness, or merge readiness. Select from the top-level `activeChanges`; repository entries are filtered projections, not separately owned Change records. The canonical active Change lives at `~/.sdd/changes/<change-id>/`, closed history lives at `~/.sdd/changes/closed/<change-id>/`, and `tasks.md.repositories` names the full stable target set. Epics, ADRs, implementation, tests, and supporting docs stay repository-local. Resolve source and target policy, hosting provider, required checks, comment workflow, merge strategy, release communication, and permissions separately for every target repository. GitHub commands below apply only when GitHub is the configured provider. If user setup is missing, direct the user to `sdd setup`; if a repository contract is missing, direct them to `sdd init` there. Use `sdd doctor` for an existing but unhealthy installation.

Use `/sdd-release` for production-branch release PR preparation. Use `/sdd-pr` for ongoing PR stewardship after a PR exists, or for non-production PRs that are part of the project's normal branch policy.

Resolve source and target branches from explicit user input first, then the app's `AGENTS.md` branch policy. Do not assume a universal `develop` into `main` workflow.

This skill may create branches, commits, pushes, and PR comments when needed. Never merge the PR unless the user explicitly approves the final merge after the review loop is clean.

Treat PR creation and PR stewardship as separate phases. On the activation that creates a new PR, do not immediately conclude there are no comments or that the PR is ready to merge; CI, automation, and humans need time to react. Report the new PR URL, current checks if any, and tell the user to rerun `/sdd-pr` after reviewers or automation have had time to comment. On later activations for an existing PR, run the comment/check stewardship loop.

Non-negotiable invariant: PR feedback must not move implementation beyond the durable Epic/Story map or beyond the commit covered by SDD review without an explicit reconciliation. Track the immutable reviewed source commit, latest reconciled PR head, and a Remote Review Watermark for each configured reviewer and status check. A resolved comment or completed review on an older head is historical evidence, not current-head coverage. Do not return a merge-ready result while the current PR head contains unclassified or unreconciled post-review commits or any required reviewer/check watermark remains pending, failed, unavailable without an accepted policy path, or stale for a material change.

Multi-repository invariant: derive the complete target set from the central `tasks.md`, steward every required repository PR, and record repository-specific branches, commits, URLs, checks, review watermarks, acceptance, and merge state in that one ledger. A clean or merged PR never makes the Change globally complete by itself. Never create, commit, push, or infer a repository-local Change copy, and never transition or close targets independently.

A `/sdd-review` verdict of `ready` establishes technical review readiness. It does not by itself prove that required manual acceptance is complete. Resolve the current manual confirmation status from `tasks.md` or the review record and apply project policy separately. PR creation may proceed with `pending user` only when project policy allows review to continue before acceptance; never describe the PR as merge-ready or perform the merge while required confirmation remains pending.

## Inputs

Infer inputs in this order:

- Source and target branches: explicit user branches for each target, otherwise each repository's branch policy. Do not assume every target uses the same branch pair.
- Target repositories: the stable repository IDs in the selected central `tasks.md`; resolve every ID to its current local root and repository contract.
- Central Change: explicit Change path/ID, otherwise the unique compatible record selected from top-level `sdd status <space-id> --json` output.
- PR mode:
  - default: create the PR if missing; otherwise check and address accepted review comments with narrow fixes, then stop before merge.
  - `--check`: inspect and report only; do not edit code, comment, resolve, push, or create a PR.
  - `--until-clean`: keep looping until no actionable comments remain or a stop condition is reached.
  - `--check-now`: after creating a PR, immediately perform a best-effort comment/check pass anyway. Use only when the user explicitly asks for an immediate check.

If the source branch, target branch, provider, or project policy cannot be inferred safely, ask before mutating git or remote review state.

## Initial Setup

1. Read workspace guidance, the one central Change, and every target repository's local guidance before mutating files:
   - root and repository-local `AGENTS.md`, especially branch policy
   - relevant README or workflow docs
   - central `proposal.md`, `design.md`, `tasks.md`, and `review.md` when present
2. Inspect git state, remotes, and current branches in every target repository.
3. Preserve unrelated dirty files. Do not stash, reset, or overwrite user changes unless explicitly approved.
4. For each target repository, ensure the source branch contains its intended implementation, tests, Epic/ADR/supporting truth, and review remediation:
   - Commit required repository-local work only when the user has authorized PR work in this request or earlier in this PR workflow.
   - Never stage or commit `~/.sdd/changes/<change-id>/`; update it separately as the one user-local coordination ledger.
   - Resolve the current source commit SHA and the last source commit covered by `/sdd-review` from central `review.md` or `tasks.md`. Treat a branch name alone as mutable context, not as the review watermark.
   - Resolve repository-specific manual confirmation and whether project policy requires `user confirmed` or an `accepted gap` before PR creation, merge readiness, or merge.
   - Build the exact source-to-target changed-file inventory and classify every path against the intended Change, required repository-local truth, review remediation, or generated output required by project policy. Stop on unexplained or unrelated paths.
   - For any commit made by this workflow, derive an exact path allowlist from the accepted comment plus required tests, Epic reconciliation, supporting docs, and release communication. Stage only those paths; compare the staged and committed name-status lists to the allowlist.
5. Push each participating source branch:
   - Use `git push -u origin <source>` when no upstream exists.
   - Do not force-push unless the user explicitly asks.

## Open Or Update The PR

Use each target repository's configured provider tooling. For each GitHub target, the CLI commands are:

```bash
gh pr view --base <target> --head <source> --json number,url,state,title,mergeStateStatus,reviewDecision
gh pr create --base <target> --head <source> --title "<title>" --body "<body>"
```

If a PR already exists for a target's source/target pair, reuse it and update the body only when it is materially stale.

Each PR body should include:

- source and target branches
- summary of behavior changes
- verification run
- known risks or follow-up decisions
- public-safe central SDD Change ID plus repository-local Epic, review, release, or plan links when present; never include the user-local Change path
- reviewed source commit
- latest reconciled PR head
- post-review change classifications, or `none`
- remote reviewer/check watermarks: reviewer/check, required or optional, triggered head, completed head, and result
- manual confirmation status and any acceptance step still required before merge

Do not put private planning notes into public PR bodies. Summarize public-safe facts only.

After creating any new PR:

1. Fetch the PR once to capture the URL, initial merge state, and checks that already exist.
2. Do not post a "no comments" or "ready to merge" steward comment yet unless the user explicitly used `--check-now`.
3. End the activation with a clear waiting state:
   - PR created
   - checks may still be pending
   - no review pass has been completed yet
   - rerun `/sdd-pr` later to process comments and checks

For each existing PR:

1. Continue to `Collect Comments And Checks`.
2. Treat each activation as a fresh review loop over that PR's current state.
3. Recompute its diff and classify every changed path before addressing comments; do not trust a prior allowlist after new commits arrive.
4. Keep the central ledger synchronized with each target repository's PR URL, head, checks, watermarks, acceptance, and merge state without duplicating the Change.

## Collect Comments And Checks

Fetch every review surface for every target repository PR, not just one. For GitHub, this includes:

```bash
gh pr view <number> --json comments,reviews,reviewDecision,mergeStateStatus,statusCheckRollup
gh api repos/:owner/:repo/pulls/<number>/comments
gh api repos/:owner/:repo/issues/<number>/comments
gh api graphql -f query='... reviewThreads ...'
```

Classify each item:

- `actionable`: valid issue that should be fixed before merge.
- `answer-only`: valid question or suggestion that needs a response but no code change.
- `declined`: understood, but not appropriate to address now. Explain why.
- `stale`: already fixed by current code or superseded by later commits.
- `blocked`: cannot be addressed without product input, credentials, or risky broad changes.

Treat comments as advice, not commands. You are responsible for the final engineering judgment. If declining feedback, be concise, specific, and respectful.

Maintain a repository-qualified Remote Review Watermark table in each PR body or durable summary comment and mirror its current state in the central ledger:

| Reviewer / Check | Required / Optional | Triggered Head | Completed Head | State / Result |
|---|---|---|---|---|

Resolve required versus optional from project policy, branch protection, provider configuration, or explicit user direction; do not promote an optional reviewer into a universal requirement. Record the current PR head for each trigger and completion when the provider exposes it. If the provider reports only time/status, record that limitation rather than assuming the review covered the latest head. A completed old-head review may remain valid only when every later commit is classified as non-semantic or evidence-only and project policy permits reuse; otherwise retrigger it or keep the watermark stale.

## Address Comments

For each actionable comment:

1. Locate the referenced code and confirm the issue against current source.
2. Classify the expected SDD impact using the reconciliation checkpoint below.
3. Make the smallest correct change.
4. Add or update tests when the risk warrants it.
5. Reconcile repository-local Epic truth, evidence, supporting docs, and release communication plus the one central task state required by the classification.
6. Run focused verification first, then broader checks or a fresh `/sdd-review` as required.
7. Recompute the changed-file inventory and confirm every new or modified path remains inside the accepted remediation and SDD reconciliation scope.
8. Stage only the explicit remediation allowlist, compare the staged paths to it, and inspect the staged diff.
9. Commit accepted fixes with a clear message, then compare the committed paths to the same allowlist.
10. Push the source branch.
11. Record the new commit as that repository's latest reconciled PR head in the PR body or a durable PR summary comment and in central `tasks.md`, including the impact classification and verification result.
12. After material behavior, contract, security, data, API, architecture, concurrency, persistence, plugin/capability, filesystem, AI-tool, or other risk-surface fixes, retrigger configured remote reviewers/checks when the provider supports it and update their triggered-head watermarks. If retriggering is unavailable, record that fact and do not claim current-head coverage; required review remains a merge-readiness blocker unless project policy explicitly provides another accepted path.
13. Reply to the comment with what changed and the verification run.
14. Resolve the review thread when the provider exposes a resolvable thread and the issue is actually handled.

For answer-only, declined, or stale comments:

- Reply with the decision and reasoning.
- Resolve the thread only when it is appropriate and supported by the API.
- Do not mark a thread resolved if a human clearly needs to decide.

## SDD Reconciliation Checkpoint

Classify every accepted change after the last reviewed source commit. Comment disposition such as `actionable` or `declined` does not replace this impact classification.

- `non-semantic`: formatting, comments, internal cleanup, or another change that does not alter observable behavior, important ownership, verification meaning, public documentation, or release communication. Record the rationale and focused verification; no Epic edit is required.
- `code-map-or-evidence`: behavior is unchanged, but important implementation ownership, tests, assertions, or verification confidence changed. Update Story implementation/verification state, behavior-mapped `Implemented By`, `Implementation Gaps`, scenario-mapped `Verified By`, `Verification Gaps`, and affected supporting docs.
- `existing-contract-fix`: implementation is corrected to satisfy an existing Requirement or Scenario. Update implementation/evidence maps and active task state when present, then run the affected SDD review gates. Use a fresh full `/sdd-review` when the fix materially changes the reviewed diff or risk surface.
- `behavior-or-contract-change`: observable behavior, Requirements, Scenarios, API semantics, permissions, validation, recovery, data handling, security behavior, or user-facing release meaning changed. Reconcile the affected Epic, supporting docs, and release communication, then require a fresh `/sdd-review` before merge readiness.
- `scope-product-or-architecture-change`: the feedback expands scope or changes product direction, Epic ownership, durable architecture, data model, auth model, public API, migration, deployment, or external-service behavior. Stop PR remediation and route to `/sdd-change --replan`, `/sdd-adr`, or `/sdd-prd` as appropriate.

Do not reopen or edit a centrally closed Change merely to log ordinary PR feedback. Reconcile current repository-local Epic/Story truth and supporting docs instead; route a genuine new scope or behavior change through a new central Change.

## Review Loop

Repeat across the complete target PR set until one global stop condition applies:

- no actionable comments or unresolved required review threads remain in any target PR
- required checks fail and cannot be fixed safely in this workflow
- the same issue remains after two fix attempts
- the fix requires broad redesign, secrets, production access, destructive action, or product clarification
- the user needs to decide between valid alternatives

Each loop iteration should:

1. Refresh comments, review threads, checks, branch status, and every remote reviewer/check watermark for every target PR.
2. Resolve each current PR head and compare it with that repository's reviewed source commit and latest reconciled PR head.
3. Reclassify comments against current code and classify the SDD impact of accepted changes.
4. Address accepted comments and reconcile repository-local truth plus the central ledger.
5. Push changes and reply/resolve threads.
6. Update affected PR bodies or durable summary comments and central `tasks.md` with current reconciliation and remote-review watermarks whenever state materially changes.

## Verification

Choose verification from changed risk:

- comment-specific focused tests
- lint/typecheck/build
- app-specific e2e or regression tests
- SDD template, Story index, generated-doc, or traceability checks when reconciliation changes SDD artifacts or the PR fix could invalidate SDD integrity
- security checks when comments touch auth, secrets, permissions, data exposure, or deployment config
- a fresh `/sdd-review` when post-review changes alter behavior, contracts, security, data handling, APIs, architecture, or another material part of the reviewed risk surface

Record exact commands and results in the final response and, when useful, in a PR comment.

## Final Gate

Use the final gate only after every required target repository has an existing PR and each has received at least one stewardship pass that was not the same activation that created it.

When no target PR has actionable comments left:

1. Confirm every target PR's current status:
   - review decision, unresolved threads, required checks, and mergeability
   - every configured reviewer/check has a recorded required-or-optional classification, triggered head, completed head when available, and result
   - every required reviewer/check is terminal and successful for the current material head; resolved old-head comments alone do not satisfy this gate
   - optional pending, unavailable, or stale review is recorded with the policy reason it does not block merge readiness
2. Confirm SDD review freshness for every target:
   - exact current PR head
   - immutable source commit covered by the last `/sdd-review`
   - latest reconciled PR head
   - every commit after the reviewed source commit has an impact classification
   - behavior, contract, security, data, API, architecture, or other material risk changes received a fresh global `/sdd-review`
   - Epic truth, evidence, supporting docs, and release communication match the current PR head
   - the final source-to-target file inventory is identical to the classified PR scope, with no unexplained path
3. Confirm global acceptance readiness:
   - central `tasks.md` records canonical manual-confirmation status per target where needed
   - any project-required walkthrough remains complete and current for the reviewed PR head
   - required confirmation is `user confirmed` or an explicitly accepted gap before merge readiness
   - when required confirmation is still `pending user`, report the technically clean PR set and present the walkthrough, but do not call the Change merge-ready or ask for merge approval
4. Confirm the central coordination gate:
   - every target repository has a current PR URL, source/target pair, reviewed commit, current head, remote-review watermark, acceptance state, and merge state
   - no repository-local Change copy or independently transitioned lifecycle state exists
   - one target's clean or merged PR is not reported as global completion while another target is pending
5. Post concise repository-specific PR comments when useful, covering comments addressed, declined comments, verification, reviewed/current heads, remote-review watermarks, and remaining non-blocking risks.
6. Stop and prompt the user only after every target's technical, remote-review, coordination, and required acceptance gates pass:
   - Say the coordinated PR set is ready for their review/approval.
   - Provide every PR URL.
   - Ask them to approve the actual merges in the policy-required order.

Do not invoke the provider's merge action, delete branches, or change repository protection settings without explicit user approval after this final gate.

## Final Response

Lead with the phase result.

Include:

- every PR URL and source -> target pair, keyed by repository ID
- whether this activation created or stewarded each PR
- comments addressed, declined, stale, or blocked per repository
- commits pushed per repository
- reviewed source commit, current PR head, and latest reconciled PR head per repository
- remote reviewer/check watermarks, including required/optional classification and triggered/completed heads
- post-review change classifications and repository-local Epic/supporting truth reconciled
- central `tasks.md` coordination state; never publish its user-local path
- verification commands and results
- manual confirmation status and whether acceptance blocks global merge readiness
- remaining risks, sequencing constraints, or required user decisions
- if any PR was newly created: tell the user to rerun `/sdd-pr` after review comments/checks have had time to appear
- if every existing PR is clean: clearly request approval for the actual merges in order
