---
name: sdd-changelog
description: Create or update one candidate-bound changelog, release-note, changeset, or equivalent entry for a completed SDD Change or clearly scoped manual change. Use after review and Epic reconciliation, when the user asks to document what changed, add release notes, update a changelog, prepare one Change's release communication, or determine whether completed work needs a public/operator-facing entry. Preserves the repository's native convention, returns no-op for internal-only, duplicate, generated, or speculative work, and stops before versioning, staging, commits, PRs, release, or deployment.
---

# SDD Changelog

Write the release communication owned by one completed Change or clearly scoped manual candidate. This is a candidate-bound mutation capability, not release aggregation, versioning, code review, or implementation.

## Inputs

Accept:

```text
/sdd-changelog [repository-or-change-path] --baseline <commit-ish> [--candidate working-tree|<commit-ish>]
/sdd-changelog [repository-or-change-path] --change <change-id> [--baseline <commit-ish>] [--candidate working-tree|<commit-ish>]
```

The conceptual input is one shared diff envelope per repository:

- stable repository ID and resolved root;
- immutable baseline commit SHA;
- candidate kind: current working tree or explicit commit/ref;
- candidate SHA when committed, or HEAD plus staged, unstaged, and relevant untracked state for a working tree;
- optional Change ID, slice ID, Requirement/Scenario references, current Review result, Epic Update result, accepted gaps, and manual-acceptance state.

An active Change, Apply session, or Implementation Ledger row is optional. Manual changes use the same public contract; never fabricate Apply history or a retroactive Change solely to authorize release communication.

When the baseline, candidate, repository, or owned release record is ambiguous, return `needs-user`. Do not infer a target branch, merge base, prior release, or public record without caller, Change, review, or project-policy evidence.

## Resolve The Candidate And Policy

1. Resolve workspace, Space, repository, artifact roots, and `workflowPath` with `sdd context <relevant-path> --json`; read the returned doctrine and all applicable workspace/repository `AGENTS.md` files.
2. Resolve an explicit Change from the top-level canonical inventory returned by `sdd status <space-id> --json`. Use `change.md`, `tasks.md`, and `review.md` as scope and reviewed-outcome evidence, not as public prose to copy.
3. Establish the exact envelope. Prefer the deterministic helper:

   ```bash
   sdd candidate resolve <repository-path> \
     --baseline <commit-ish> \
     --candidate <working-tree-or-commit-ish> \
     --workspace <workspace-root> \
     --json
   ```

   It resolves refs to immutable SHAs, rejects non-ancestor ranges, inventories committed or staged/unstaged/untracked changed paths, and returns a content-sensitive candidate watermark without deciding notability or mutating artifacts.
4. Require current review evidence for the implementation candidate. A code, contract, security, data, documentation, or behavior change after the reviewed watermark routes to `/sdd-review`; do not summarize unreviewed outcomes as complete.
5. When behavior, ownership, or durable evidence changed, require a current `/sdd-epic-update` result for the implementation candidate or an evidence-based `no-op`. Missing or stale reconciliation routes to `/sdd-epic-update`.
6. Read the repository's changelog/release-note policy from local guidance, README/release docs, manifests, release tooling, existing records, and generators. Preserve its native convention: Keep a Changelog, changesets, generated provider notes, package release notes, another project record, or explicitly no per-change record.
7. Record the initial implementation-input watermark and existing release-record snapshot. Multi-repository Changes require one independently resolved envelope, policy, decision, and result block per repository.

Do not add changelog paths to the portable repository schema merely to complete this workflow. Project guidance owns location, format, generator, and public/private policy because one path cannot represent every release system.

## Decide Whether An Entry Is Warranted

Classify the reviewed result:

- `user-visible` — adds, changes, fixes, deprecates, removes, or secures behavior users can observe;
- `operator-relevant` — changes deployment, configuration, compatibility, migration, security posture, recovery, or supported operation in a way operators need to know;
- `internal-only` — refactor, test, implementation mapping, formatting, or maintenance with no public/operator consequence;
- `speculative-or-unverified` — planned, incomplete, disputed, stale, or unsupported by the reviewed candidate.

Return `no-op` when:

- the result is internal-only and project policy does not record internal changes;
- project policy intentionally generates release communication later and no source entry is required;
- the repository explicitly has no per-change release record;
- an existing entry already states the reviewed outcome accurately for the same candidate;
- the candidate contains only Epic, review, changelog, or other bookkeeping changes with no independently notable outcome.

Return `routed` for speculative or unverified work. Do not turn plans, open tasks, test names, or implementation mechanics into release claims.

## Write One Native Entry

Create or update only the entry owned by this completed Change or manual candidate:

- Use product language describing the outcome and who benefits. Include operator action, migration, compatibility impact, security significance, or known accepted limitation only when relevant.
- Preserve the repository's existing headings, categories, ordering, links, wrapping, identifiers, changeset metadata, and generator workflow.
- For Keep a Changelog, edit only the appropriate `Unreleased` category; never add a version/date or rewrite released sections.
- For one-file-per-change systems, create or update exactly one native entry with the project's required metadata.
- For generated records, invoke only the documented owning generator. Never hand-edit generated output.
- Update a stale or duplicate entry rather than adding a second claim for the same outcome.
- Keep public communication public-safe: omit private planning paths, internal SDD ledgers, prompts, secrets, user data, speculative roadmap commitments, command logs, and implementation details that do not help the audience.
- Align every claim with the final reviewed implementation, current Epic truth, durable proof, and explicitly accepted gaps. Do not imply manual acceptance, production deployment, version availability, or release timing that has not occurred.

A candidate may need no entry even when code changed. A documentation-only public correction may need an entry even when runtime behavior did not.

## Validate Candidate Preservation And Idempotence

After editing each repository:

1. Re-run `sdd candidate resolve` against the same baseline and a working-tree candidate.
2. Compare the before/after projections. Only the project-policy release-record path or generator-owned output authorized by this capability may be newly changed. Application code, tests, schemas, configuration, Epics, review artifacts, or unrelated files changing during this capability returns `blocked`.
3. Confirm the implementation-input projection remains unchanged after excluding only owned release-communication edits. Report both the reviewed implementation candidate and post-changelog repository watermark; the expected changelog-only watermark change does not invalidate Review or Epic Update when this projection is proved.
4. Run project-defined changelog, changeset, docs, formatting, or release-record validation when present. Do not run versioning or release mutation commands.
5. Re-open the final entry and compare each claim with the reviewed diff, current Epic truth, and accepted gaps.
6. Re-run the decision for the same candidate. A second invocation should normally produce no release-record changes and return `no-op`.

The CLI proves envelope facts, not notability or prose truth. This skill owns those semantic judgments.

## Routes And Stop Conditions

Return `routed` when:

- review is missing or stale: route to `/sdd-review`;
- Epic truth or evidence is missing or stale for changed behavior: route to `/sdd-epic-update`;
- implementation, verification, or accepted behavior is incomplete: route to `/sdd-apply`, `/sdd-change`, or the applicable verification workflow;
- consequential release-wide aggregation or version intent is requested: route to `/sdd-release` after the candidate entry is current.

Return `blocked` for unsafe repository state, inaccessible policy/evidence, conflicting native records, failed required record validation, generated output without its owner, or a candidate that changes during the operation. Return `needs-user` when the repository has no resolvable convention, the audience/notability decision is genuinely ambiguous, or competing records could both own the entry.

## Terminal Boundary

Stop after one candidate-specific release entry is current and validated. Do not:

- review or modify application code, tests, schemas, migrations, runtime configuration, Epics, or Change artifacts;
- change Change lifecycle state or manual acceptance;
- choose or write a release version, date an unreleased section, aggregate multiple Changes into release notes, or decide release scope;
- stage, commit, push, open or merge a PR, tag, publish, announce, release, deploy, or close a Change.

Recommend those as separately invoked workflows. `/sdd-release` owns release-wide aggregation, version recommendation/confirmation, promotion of unreleased records, and production handoff.

## Result Contract

Return exactly one composable status:

- `complete` — one warranted candidate-specific entry was created or corrected and its native validation passes;
- `no-op` — policy requires no entry or the accurate entry already exists;
- `needs-user` — policy, ownership, or notability requires a user decision;
- `blocked` — safe mutation or required validation cannot complete;
- `routed` — Review, Epic Update, Change, Apply/verification, or Release owns the next work.

Also report:

- one diff envelope per repository: repository ID/root, immutable baseline, reviewed candidate kind and watermark, and staged/unstaged/relevant-untracked state where applicable;
- optional Change, slice, Requirement, Scenario, Review, Epic Update, acceptance, and accepted-gap inputs used;
- release-record policy source and resolved native owner;
- classification and evidence-based notability decision;
- entry path/section or generated source, action (`created`, `updated`, `no-op`), and concise final text;
- artifacts read and written plus validation commands/results;
- implementation-projection preservation and idempotence result;
- post-changelog candidate watermark and gates that remain current or became stale;
- unresolved ambiguity, routes, blockers, and recommended next workflow.

## Self Improvement
After completing this skill ask yourself "what improvements to this skill could be made that would improve our overall SDD workflow?" Report any suggestions to the user.