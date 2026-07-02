---
name: sdd-pr
description: Use when the user invokes /sdd-pr or asks to open, manage, review, or steward a pull request for SDD-backed work according to the app's AGENTS.md branch policy. Creates a GitHub PR when one does not exist, and on later activations checks review comments, requested changes, status checks, and review threads; decides which feedback is valid; addresses accepted comments; replies and resolves handled threads; loops until no actionable comments remain; then asks the user to approve the actual merge. Use /sdd-release first for production-branch release PR creation and /sdd-pr afterward to steward an existing release PR.
---

# SDD PR

Open and steward a GitHub pull request for SDD-backed work from one branch into another.

Use `/sdd-release` for production-branch release PR preparation. Use `/sdd-pr` for ongoing PR stewardship after a PR exists, or for non-production PRs that are part of the project's normal branch policy.

Resolve source and target branches from explicit user input first, then the app's `AGENTS.md` branch policy. Do not assume a universal `develop` into `main` workflow.

This skill may create branches, commits, pushes, and PR comments when needed. Never merge the PR unless the user explicitly approves the final merge after the review loop is clean.

Treat PR creation and PR stewardship as separate phases. On the activation that creates a new PR, do not immediately conclude there are no comments or that the PR is ready to merge; GitHub apps, CI, and humans need time to react. Report the new PR URL, current checks if any, and tell the user to rerun `/sdd-pr` after reviewers or bots have had time to comment. On later activations for an existing PR, run the comment/check stewardship loop.

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

If the source branch, target branch, or app branch policy cannot be inferred safely, ask before touching git or GitHub.

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
   - If the PR is for SDD-backed work, also check the workflow repo for related change folders, review reports, project docs, generated indexes, or lifecycle notes. Commit and push those related workflow files when commits are authorized before treating the PR branch as ready. Never include unrelated dirty files.
   - Use focused commit messages.
5. Push the source branch:
   - Use `git push -u origin <source>` when no upstream exists.
   - Do not force-push unless the user explicitly asks.

## Open Or Update The PR

Prefer GitHub CLI when available:

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

Fetch all review surfaces, not just one:

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
2. Make the smallest correct change.
3. Add or update tests when the risk warrants it.
4. Run focused verification first, then broader checks as needed.
5. Commit accepted fixes with a clear message.
6. Push the source branch.
7. Reply to the comment with what changed and the verification run.
8. Resolve the review thread when the GitHub API exposes a resolvable thread id and the issue is actually handled.

For answer-only, declined, or stale comments:

- Reply with the decision and reasoning.
- Resolve the thread only when it is appropriate and supported by the API.
- Do not mark a thread resolved if a human clearly needs to decide.

## Review Loop

Repeat until one stop condition applies:

- no actionable comments or unresolved required review threads remain
- required checks fail and cannot be fixed safely in this workflow
- the same issue remains after two fix attempts
- the fix requires broad redesign, secrets, production access, destructive action, or product clarification
- the user needs to decide between valid alternatives

Each loop iteration should:

1. Refresh PR comments, review threads, checks, and branch status.
2. Reclassify comments against current code.
3. Address accepted comments.
4. Push changes and reply/resolve threads.
5. Update the PR body or a summary comment if the PR state materially changed.

## Verification

Choose verification from changed risk:

- comment-specific focused tests
- lint/typecheck/build
- app-specific e2e or regression tests
- SDD story index or generated docs checks when SDD files changed
- security checks when comments touch auth, secrets, permissions, data exposure, or deployment config

Record exact commands and results in the final response and, when useful, in a PR comment.

## Final Gate

Use the final gate only for an existing PR after at least one stewardship pass that was not the same activation that created the PR.

When the existing PR has no actionable comments left:

1. Confirm current PR status:
   - review decision
   - unresolved threads
   - required status checks
   - mergeability
2. Post a concise PR comment if useful:
   - comments addressed
   - declined comments and reasons
   - verification run
   - remaining non-blocking risks
3. Stop and prompt the user:
   - Say the PR is ready for their review/approval.
   - Provide the PR URL.
   - Ask them to approve the actual merge.

Do not run `gh pr merge`, click merge buttons, delete branches, or change repository protection settings without explicit user approval after this final gate.

## Final Response

Lead with the phase result.

Include:

- PR URL and source -> target
- whether this activation created the PR or stewarded an existing PR
- comments addressed, declined, stale, or blocked
- commits pushed
- verification commands and results
- remaining risks or required user decisions
- if newly created: tell the user to rerun `/sdd-pr` after review comments/checks have had time to appear
- if existing and clean: clear request for the user to approve the merge when ready

## Final Self-Improvement Action

After completing or stopping this workflow, end the final user response with a concise self-improvement conclusion:

- Ask yourself: "How well did this work, and what could have been improved?"
- Tell the user the conclusion in 1-3 sentences.
- Name any concrete skill, template, doctrine, or process improvement worth considering.
- If no specific improvement is evident, say so plainly.
