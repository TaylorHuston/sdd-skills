---
name: sdd-pr
description: Use when the user invokes /sdd-pr or asks to open, manage, review, or steward a pull request for SDD-backed work according to project branch and review policy. Creates a PR through the configured provider when one does not exist, and on later activations checks comments, requested changes, status checks, and review threads; addresses accepted feedback; reconciles post-review changes into Epic truth; preserves review freshness against the current PR head; and asks the user to approve the actual merge only after the loop is clean. Use /sdd-release first for production release handoff preparation and /sdd-pr afterward when that handoff is a PR.
---

# SDD PR

Open and steward a pull request for SDD-backed work from one branch into another.

## Authority And Project Profile

Resolve the workspace and repository with `sdd context <relevant-path> --json`, then read `<workspaceRoot>/.sdd/story-driven-development.md` completely before judging reconciliation, evidence, review freshness, or merge readiness. Resolve source and target policy, hosting provider, required checks, comment workflow, merge strategy, release communication, and permissions from project guidance. SDD artifacts remain under the resolved repository's canonical `docs/` tree. GitHub commands below apply only when GitHub is the configured provider. If the managed workflow document is missing, stop and direct the user to `sdd init` or `sdd doctor`.

Use `/sdd-release` for production-branch release PR preparation. Use `/sdd-pr` for ongoing PR stewardship after a PR exists, or for non-production PRs that are part of the project's normal branch policy.

Resolve source and target branches from explicit user input first, then the app's `AGENTS.md` branch policy. Do not assume a universal `develop` into `main` workflow.

This skill may create branches, commits, pushes, and PR comments when needed. Never merge the PR unless the user explicitly approves the final merge after the review loop is clean.

Treat PR creation and PR stewardship as separate phases. On the activation that creates a new PR, do not immediately conclude there are no comments or that the PR is ready to merge; CI, automation, and humans need time to react. Report the new PR URL, current checks if any, and tell the user to rerun `/sdd-pr` after reviewers or automation have had time to comment. On later activations for an existing PR, run the comment/check stewardship loop.

Non-negotiable invariant: PR feedback must not move implementation beyond the durable Epic/Story map or beyond the commit covered by SDD review without an explicit reconciliation. Track the immutable reviewed source commit and the latest reconciled PR head. Do not return a merge-ready result while the current PR head contains unclassified or unreconciled post-review commits.

## Inputs

Infer inputs in this order:

- Source branch: explicit user branch, otherwise current branch when it is not the policy target, otherwise the app branch policy's default work branch or integration branch.
- Target branch: explicit user branch, otherwise the app branch policy's PR, review, integration, or stable target.
- Repository root: current git repo, or the app repo implied by the conversation.
- PR mode:
  - default: create the PR if missing; otherwise check and address review comments, then stop before merge.
  - `--check`: inspect and report only; do not edit code, comment, resolve, push, or create a PR.
  - `--fix`: allow narrow code, test, and documentation changes for accepted PR comments.
  - `--until-clean`: keep looping until no actionable comments remain or a stop condition is reached.
  - `--check-now`: after creating a PR, immediately perform a best-effort comment/check pass anyway. Use only when the user explicitly asks for an immediate check.

If the source branch, target branch, provider, or project policy cannot be inferred safely, ask before mutating git or remote review state.

## Initial Setup

1. Read repo guidance before mutating files:
   - root `AGENTS.md`
   - project-local `AGENTS.md`, especially the branch policy
   - relevant README or workflow docs
   - active SDD change artifacts when the PR is SDD-backed
2. Inspect git state:
   - `git status --short --branch`
   - `git remote -v`
   - `git branch --show-current`
3. Preserve unrelated dirty files. Do not stash, reset, or overwrite user changes unless explicitly approved.
4. Ensure source branch has the intended commits:
   - If the current branch has uncommitted changes required for the PR, commit them only when the user has authorized PR work in this request or earlier in this PR workflow.
   - If the PR is for SDD-backed work, also check the workflow repo for related Change folders, machine-readable `tasks.md` status, review reports, project docs, or generated indexes. Commit and push those related workflow files when commits are authorized before treating the PR branch as ready. Never include unrelated dirty files.
   - Use focused commit messages.
   - Resolve the current source commit SHA and the last source commit covered by `/sdd-review` from `review.md`, `tasks.md`, or the PR body. Treat a branch name alone as mutable context, not as the review watermark.
5. Push the source branch:
   - Use `git push -u origin <source>` when no upstream exists.
   - Do not force-push unless the user explicitly asks.

## Open Or Update The PR

Use the configured provider's available tooling. For GitHub, the CLI commands are:

```bash
gh pr view --base <target> --head <source> --json number,url,state,title,mergeStateStatus,reviewDecision
gh pr create --base <target> --head <source> --title "<title>" --body "<body>"
```

If a PR already exists for the source/target pair, reuse it and update the body only when it is materially stale.

PR body should include:

- source and target branches
- summary of behavior changes
- verification run
- known risks or follow-up decisions
- SDD change, review, release, or plan links when present and public-safe
- reviewed source commit
- latest reconciled PR head
- post-review change classifications, or `none`

Do not put private planning notes into public PR bodies. Summarize public-safe facts only.

After creating a new PR:

1. Fetch the PR once to capture the URL, initial merge state, and checks that already exist.
2. Do not post a "no comments" or "ready to merge" steward comment yet unless the user explicitly used `--check-now`.
3. End the activation with a clear waiting state:
   - PR created
   - checks may still be pending
   - no review pass has been completed yet
   - rerun `/sdd-pr` later to process comments and checks

For an existing PR:

1. Continue to `Collect Comments And Checks`.
2. Treat each activation as a fresh review loop over the current PR state.

## Collect Comments And Checks

Fetch all review surfaces, not just one. For GitHub, this includes:

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

## Address Comments

For each actionable comment:

1. Locate the referenced code and confirm the issue against current source.
2. Classify the expected SDD impact using the reconciliation checkpoint below.
3. Make the smallest correct change.
4. Add or update tests when the risk warrants it.
5. Reconcile Epic truth, evidence, supporting docs, release communication, and active task state required by the classification.
6. Run focused verification first, then broader checks or a fresh `/sdd-review` as required.
7. Commit accepted fixes with a clear message.
8. Push the source branch.
9. Record the new commit as the latest reconciled PR head in the PR body or a durable PR summary comment, including the impact classification and verification result.
10. Reply to the comment with what changed and the verification run.
11. Resolve the review thread when the provider exposes a resolvable thread and the issue is actually handled.

For answer-only, declined, or stale comments:

- Reply with the decision and reasoning.
- Resolve the thread only when it is appropriate and supported by the API.
- Do not mark a thread resolved if a human clearly needs to decide.

## SDD Reconciliation Checkpoint

Classify every accepted change after the last reviewed source commit. Comment disposition such as `actionable` or `declined` does not replace this impact classification.

- `non-semantic`: formatting, comments, internal cleanup, or another change that does not alter observable behavior, important ownership, verification meaning, public documentation, or release communication. Record the rationale and focused verification; no Epic edit is required.
- `code-map-or-evidence`: behavior is unchanged, but important implementation ownership, tests, assertions, or verification confidence changed. Update Story `Implemented By`, scenario-mapped `Verified By`, `Verification Gaps`, and affected supporting docs.
- `existing-contract-fix`: implementation is corrected to satisfy an existing Requirement or Scenario. Update implementation/evidence maps and active task state when present, then run the affected SDD review gates. Use a fresh full `/sdd-review` when the fix materially changes the reviewed diff or risk surface.
- `behavior-or-contract-change`: observable behavior, Requirements, Scenarios, API semantics, permissions, validation, recovery, data handling, security behavior, or user-facing release meaning changed. Reconcile the affected Epic, supporting docs, and release communication, then require a fresh `/sdd-review` before merge readiness.
- `scope-product-or-architecture-change`: the feedback expands scope or changes product direction, Epic ownership, durable architecture, data model, auth model, public API, migration, deployment, or external-service behavior. Stop PR remediation and route to `/sdd-propose --replan`, `/sdd-adr`, or `/sdd-prd` as appropriate.

Do not reopen a closed Change merely to log ordinary PR feedback. Epic/Story truth is authoritative. Update a closed artifact only when its present-tense claims would otherwise materially contradict accepted behavior or Change status.

## Review Loop

Repeat until one stop condition applies:

- no actionable comments or unresolved required review threads remain
- required checks fail and cannot be fixed safely in this workflow
- the same issue remains after two fix attempts
- the fix requires broad redesign, secrets, production access, destructive action, or product clarification
- the user needs to decide between valid alternatives

Each loop iteration should:

1. Refresh PR comments, review threads, checks, and branch status.
2. Resolve the current PR head and compare it with the reviewed source commit and latest reconciled PR head.
3. Reclassify comments against current code and classify the SDD impact of accepted changes.
4. Address accepted comments and reconcile required artifacts.
5. Push changes and reply/resolve threads.
6. Update the PR body or a durable summary comment with the current reconciliation watermark when the PR state materially changed.

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

Use the final gate only for an existing PR after at least one stewardship pass that was not the same activation that created the PR.

When the existing PR has no actionable comments left:

1. Confirm current PR status:
   - review decision
   - unresolved threads
   - required status checks
   - mergeability
2. Confirm SDD review freshness:
   - exact current PR head
   - immutable source commit covered by the last `/sdd-review`
   - latest reconciled PR head
   - every commit after the reviewed source commit has an impact classification
   - behavior, contract, security, data, API, architecture, or other material risk changes received a fresh `/sdd-review`
   - Epic truth, evidence, supporting docs, and release communication match the current PR head
3. Post a concise PR comment if useful:
   - comments addressed
   - declined comments and reasons
   - verification run
   - reviewed source commit and latest reconciled PR head
   - remaining non-blocking risks
4. Stop and prompt the user:
   - Say the PR is ready for their review/approval.
   - Provide the PR URL.
   - Ask them to approve the actual merge.

Do not invoke the provider's merge action, delete branches, or change repository protection settings without explicit user approval after this final gate.

## Final Response

Lead with the phase result.

Include:

- PR URL and source -> target
- whether this activation created the PR or stewarded an existing PR
- comments addressed, declined, stale, or blocked
- commits pushed
- reviewed source commit, current PR head, and latest reconciled PR head
- post-review change classifications and SDD artifacts reconciled
- verification commands and results
- remaining risks or required user decisions
- if newly created: tell the user to rerun `/sdd-pr` after review comments/checks have had time to appear
- if existing and clean: clear request for the user to approve the merge when ready
