---
name: sdd-review
description: Independently review one exact v2 SDD outcome candidate or the final Change candidate. Record five universal gates, concrete risk-triggered checks, separate Spec Adherence and Implementation Quality judgments, honest gaps, and integration readiness in the one central review.md.
---

# SDD Review

Judge an exact candidate independently from its implementer. Review owns findings and readiness; it does not prescribe implementation technique.

## Modes

- `--candidate-review <repository> --baseline <ref> [--candidate working-tree|<ref>]` — read-only review without requiring a Change.
- `--outcome-checkpoint <S#>` — review one active outcome and update that outcome's section in central `review.md`.
- `--seal-audit <S#>` — verify a done outcome's central Review, commit reachability, and tree equality without new adversarial discovery.
- `--deep-re-review <S#>` — explicitly reopen semantic discovery for a done outcome.
- default or `--final` — review the complete Change and update the final section of central `review.md`.
- `--check` — read-only; write no Review artifact.

Schema-less Changes and per-slice Review/receipt formats are unsupported history. Do not create, migrate, hash, or validate them as the current workflow.

## Resolve The Candidate

Use `sdd context` and `sdd status` to resolve the workspace, Change, Space, and every target repository. Read the managed workflow and applicable `AGENTS.md` files.

For each repository, record:

- stable repository ID and root;
- immutable baseline;
- committed candidate SHA or content-sensitive working-tree watermark;
- staged, unstaged, and relevant untracked state;
- changed paths and branch-policy result.

Stop when selection or attribution is ambiguous. Candidate mutation stales the Review.

An outcome checkpoint scopes Spec Adherence to that outcome's Requirements, Scenarios, constraints, and contracts while Implementation Quality covers its complete candidate and material regression surface. Final Review covers every targeted repository and all completed outcomes.

## Five Universal Gates

Record exactly these universal gates in `review.md`:

1. `scope-candidate` — the complete attributable candidate and intended outcome are unambiguous;
2. `behavior` — implementation agrees with accepted Requirements and Scenarios;
3. `fresh-verification` — focused behavior-derived and repository-required checks are fresh for this candidate;
4. `independent-review` — separate Spec Adherence and Implementation Quality judgments are complete;
5. `integrity-authority` — gaps, manual acceptance, unrelated work, selective staging or integration, tree identity, and action authority are honest.

Each gate names the concrete check, result, and evidence. Do not expand these into a fixed universal checklist.

## Triggered Checks

Execute every expected trigger declared by the outcome with its exact recorded reason. Add only material discovered risks. A triggered row names:

- trigger ID and `planned` or `discovered` source;
- concrete reason;
- falsifiable check;
- result and evidence;
- `none`, `required`, `manual-acceptance`, `optional-confidence:<reference>`, or `user-accepted:YYYY-MM-DD` gap treatment.

Examples include UI/accessibility, security/privacy, persistence/contracts, concurrency/recovery/provider behavior, multi-repository integration, manual acceptance, or release. A UI/accessibility trigger requires current-source rendering, changed interactions, representative desktop/mobile states, console/error inspection, and applicable accessibility/reduced-motion checks; owner acceptance remains separate. Generic `not-applicable` rows and labels such as “UI passed” are insufficient.

Verification remains proportional. A broad aggregate suite is required only when repository policy, candidate breadth, integration risk, or release risk triggers it. Focused checks do not become weaker merely because an unrelated aggregate suite exists.

## Review Work

Independently:

1. inspect the complete changed-path and diff surface;
2. compare accepted behavior with actual implementation and tests;
3. trace materially changed public contracts and ownership boundaries;
4. open cited proof and confirm it exercises the claimed boundary;
5. inspect security, data safety, recovery, UI, documentation, and integration surfaces only when the candidate makes them relevant;
6. account for unavailable required evidence as a gap rather than inferring success;
7. run focused deterministic checks needed to falsify the candidate.

A blocking finding does not justify skipping other safe, materially relevant checks. A running or yielded command remains pending Review work: report progress at a reasonable interval and resume it unless the user cancels or a real stop condition applies.

Use fresh-context read-only reviewers when available and useful. The primary reviewer validates their concrete claims and owns the final verdict. Do not delegate verdict, mutation, commit, merge, release, or closeout authority.

For each declared Scenario, record exactly one coverage row with claimed boundary, durable evidence, proven boundary, result, and gap. Passing evidence must exercise the same boundary. Manual acceptance remains separate from technical proof.

## Findings And Verdict

Use:

- `BLOCKING` for unsafe or impossible continuation;
- `REQUIRED` for accepted-contract, material-safety, project-policy, false-closure, or deterministic-contract failures;
- `SUGGESTION` for non-blocking improvements.

Overall verdicts are `ready`, `changes-requested`, or `blocked`. `ready` requires:

- Spec Adherence `pass`;
- Implementation Quality `pass`;
- all five universal gates `pass`;
- all planned triggers executed;
- every Scenario accounted for with same-boundary proof or dated accepted gap;
- no unresolved required technical gap.

Required manual acceptance may remain `pending user`; report it separately and keep acceptance-dependent handoffs blocked without converting clean technical Review into a defect.

Review performs discovery, not implementation remediation. When composed by Apply, return one consolidated finding set so Apply can perform at most one safe remediation batch and request one fresh final Review.

## Central Review Record

For a v2 Change, write only `<change-path>/review.md` from `assets/review-template.md`:

- one current section per reviewed outcome;
- one optional final Change section;
- exact candidate, gates, triggers, Scenario coverage, findings, gaps, acceptance, remediation, and final commit/tree.

Replace stale current state; do not create per-slice Review files, receipts, digests, duplicate ledgers, or evidence diaries. Repository Epics remain the durable behavior/evidence map.

Outcome-checkpoint mode may update only the central Review record. It does not edit repository code, transition lifecycle, commit, push, open or merge a PR, release, deploy, or close. Final mode may recommend those handoffs but requires their separate authority.

## Result

Return `ready`, `changes-requested`, or `blocked`, plus:

- exact candidate envelope;
- separate Spec and Quality judgments;
- five universal gate rows;
- planned and discovered trigger rows;
- complete Scenario coverage;
- findings and accepted gaps;
- manual acceptance state;
- final integration/authority blockers;
- recommended next workflow.

## Self Improvement

Report one concrete improvement only when Review exposed recurring workflow friction or a missing deterministic boundary.
