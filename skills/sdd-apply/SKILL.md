---
name: sdd-apply
description: Deliver exactly one next-ready or explicitly requested outcome from a planned or in-progress v2 SDD Change. Protect unrelated work, follow repository guidance, implement and freshly verify the outcome, obtain independent Review, reconcile Epic truth when required, create one content-identical local commit, record it centrally, and stop.
---

# SDD Apply

Deliver one coherent outcome. Apply owns coordination and the final reviewed local commit; repository guidance and specialist workflows own implementation method.

## Inputs And Selection

Accept:

```text
/sdd-apply [change-id-or-path] [S#]
/sdd-apply [change-id-or-path] --outcome S#
```

Resolve the workspace, Space, Change, target repository, and `workflowPath` with `sdd context` and `sdd status`. Current work requires:

- `change.md` with `schema: sdd-change-v2` and status `planned` or `in_progress`;
- compact `tasks.md` with `Resume Here`, `Delivery Outcomes`, and `Closeout`;
- one central `review.md`.

Schema-less Changes and slice Review/receipt records are unsupported. Route them to `/sdd-change` for an explicit current-plan decision rather than interpreting or migrating them.

Select the explicitly requested outcome or the current/first ready outcome whose dependencies are done. Do not consume another outcome in the same invocation. A done outcome defaults to a deterministic audit of its central Review, commit reachability, and tree equality; do not reopen it for new semantic discovery without an explicit deep re-review request.

## Behavioral Brief

Before editing, state:

- Change and outcome;
- repository;
- observable result;
- Requirements, Story changes, and Scenarios;
- satisfied dependencies;
- binding constraints and consumed/produced contracts;
- verification intent and manual acceptance;
- applicable guidance;
- branch and dirty-state result.

When several Requirements share an outcome, confirm its coupling justification still makes one atomic session realistic. Route changed scope or accepted behavior to `/sdd-change`.

State a short transient proof sketch for the declared Scenarios. It is working reasoning, not another artifact or authoritative test plan.

## Preflight

Read all applicable workspace and repository `AGENTS.md` files and required project docs. They determine implementation process, specialist routing, tests, generated artifacts, branch policy, and documentation updates.

For the target repository:

1. record branch, full HEAD, staged, unstaged, and relevant untracked state;
2. compare the branch with policy without switching, creating, rebasing, or resetting branches;
3. establish one exact pre-outcome baseline and attributable diff envelope;
4. stop when overlapping dirty work makes attribution unsafe.

A safely attributable dirty tree is valid. Preserve every unrelated path.

If the Change is `planned`, transition it once to `in_progress`. Mark only the selected outcome `in progress` and update the replaceable Resume checkpoint.

## Implement And Verify

Implement only the selected outcome. Follow repository guidance and applicable specialist skills; Apply does not prescribe universal TDD, architecture, delegation, or commands.

After implementation:

- inspect every changed path against the baseline and classify it as outcome-owned or pre-existing;
- run fresh focused Scenario and repository-required checks on the exact candidate;
- add broad checks only when the outcome's declared/discovered risk, repository policy, integration breadth, or release boundary triggers them;
- keep technical gaps explicit. A required gap blocks completion unless the user accepts that exact gap with a date;
- keep manual product acceptance separate from technical readiness.

Any candidate mutation stales affected verification and Review.

## Independent Review

Compose `/sdd-review --outcome-checkpoint <S#>` for the exact candidate. The reviewer must be independent from the implementer and must update the selected outcome section in central `review.md` with:

- exact candidate and reviewed tree;
- five universal gate results;
- every planned trigger plus material discovered triggers, each with a concrete check and evidence;
- exact Scenario coverage;
- separate Spec Adherence and Implementation Quality results;
- findings, gaps, acceptance state, and remediation summary.

Review is `ready` only when both independent axes pass, all universal gates pass, all planned triggers are executed, no required technical gap remains, and every Scenario has same-boundary proof or dated accepted-gap treatment.

For `changes-requested`, admit findings grounded in accepted behavior, material safety, project policy, false closure, or deterministic contract failure. Apply one consolidated safe remediation batch, rerun affected verification, then obtain one fresh comprehensive final Review. Do not start an unlimited review/fix loop. Route changed behavior, unresolved decisions, or unsafe remediation to the owning workflow or user.

## Epic Reconciliation

Reconcile repository-owned Epic truth now when the candidate:

- changes accepted behavior;
- completes a Story;
- changes a contract or gap consumed by another outcome; or
- makes current implementation/evidence maps false.

Otherwise defer Epic reconciliation to final Change completion and record that decision in Review. When reconciliation changes repository files, the candidate changed: rerun affected verification and obtain a fresh independent Review for the final candidate.

Epic Update owns only current Story/Requirement/Scenario, implementation-map, evidence-map, and gap truth. It does not prescribe implementation or commit.

## Commit And Record

A `/sdd-apply` invocation authorizes one normal local commit containing only the selected outcome's attributable repository files. It does not authorize broad staging, another repository, central workspace records, push, PR, merge, amend, rebase, release, deployment, or destructive action.

After final Review is ready:

1. reconfirm branch policy, Git identity, candidate freshness, and the exact path manifest;
2. selectively stage only reviewed outcome paths;
3. inspect the staged diff and run `git diff --cached --check` plus any required staged/generated check;
4. record the staged tree and create one concise local commit;
5. prove the commit tree equals the reviewed staged tree and no outcome-owned path remains dirty;
6. update the selected central `review.md` section so its committed candidate, final commit, reviewed tree, and final commit tree agree;
7. mark the outcome `done`, refresh `Resume Here` and `Closeout`, and run focused Change validation.

Do not generate per-outcome Review files, closure receipts, Review digests, duplicate ledgers, verification descriptors, or reseal commits. `review.md` is the canonical outcome result and final commit record.

## Stop And Report

Stop after this one committed outcome. Do not begin another outcome, final Change-wide Review, changelog, PR, release, deployment, or closeout.

Return exactly one status: `complete`, `no-op`, `needs-user`, `blocked`, or `routed`.

Report:

- selected Change/outcome and resulting state;
- artifacts read and written;
- baseline, candidate, branch-policy result, and preserved dirty state;
- changed-surface summary;
- focused verification and Scenario coverage;
- Review verdict, findings, triggers, gaps, and remediation result;
- Epic reconciliation result or explicit deferral reason;
- final commit SHA, tree, and reviewed-tree equality;
- manual acceptance state;
- remaining outcomes and recommended next workflow.

## Self Improvement

Report one concrete improvement only when the outcome exposed recurring workflow friction. Do not add ceremony merely because more state could be recorded.
