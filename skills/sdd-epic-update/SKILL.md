---
name: sdd-epic-update
description: Reconcile repository-owned SDD Epic, Story, Requirement, Scenario, implementation-map, gap, and verification-map truth against one exact candidate. Use when accepted behavior, Story completion, or a consumed contract/gap changed, or when current Epic truth is demonstrably stale.
---

# SDD Epic Update

Keep the durable behavior-to-code map truthful for one exact candidate. This capability may be invoked directly or composed by Apply. It owns Epic truth, not implementation, Review, Change lifecycle, or commits.

## When To Run

Reconcile immediately when the candidate:

- changes accepted behavior;
- completes or reopens a Story;
- changes a contract or gap consumed by later work;
- changes implementation or evidence ownership enough to make current maps false.

Otherwise return an evidence-based `no-op` and defer broad Epic reconciliation to Change completion. Do not mutate Epics after every outcome merely to satisfy ceremony.

## Inputs

Accept a repository or Epic path plus an explicit baseline/candidate, or an active Change/outcome that supplies an unambiguous envelope:

```text
/sdd-epic-update <path> --baseline <ref> [--candidate working-tree|<ref>]
/sdd-epic-update <path> --change <change-id> [--outcome S#]
/sdd-epic-update <path> --epic <epic-id>
```

Resolve workspace, repository, Epic root, managed workflow, and applicable guidance. Prefer:

```bash
sdd epic update-input <repository-path> --baseline <ref> --candidate <candidate> --workspace <workspace-root> --json
```

Record the immutable baseline, exact committed candidate or content-sensitive working-tree watermark, and staged/unstaged/relevant-untracked state. Stop when attribution is unsafe or the candidate changes during reconciliation.

## Determine Affected Truth

Inspect the actual changed surface and materially relevant callers, registrations, contracts, tests, and existing Epic references. Classify changed behavior as:

- owned by an existing Requirement or Scenario;
- implementation/evidence mapping only;
- internal or supporting with no Epic mutation needed;
- undocumented or behavior-changing work that must route to `/sdd-change`.

Do not run a whole-repository audit unless the user asks or affected ownership cannot be resolved locally.

## Reconcile

Mutate only repository-owned Epic files and directly owned generated indexes. For affected Stories:

- keep Story Index and body implementation/verification states consistent;
- update accepted Requirement and Scenario wording only from accepted intent and actual behavior;
- map every implemented Requirement to concrete repository-relative governing locations and stable anchors, or record an implementation gap;
- cite focused durable Scenario evidence with inspectable paths/anchors, or record a verification gap;
- remove stale or competing maps and gaps;
- keep implementation state separate from verification state;
- preserve required, optional-confidence, manual-acceptance, and dated user-accepted gap distinctions;
- reconcile neighboring Story truth only when the candidate directly made it contradictory.

Broad commands support confidence but do not replace Scenario proof. Source inspection does not prove rendered, realtime, provider, production, or manual behavior. Temporary files, chat summaries, or bare local observations are not durable evidence.

Skills record what is implemented, what proves it, and what remains. Repository guidance and specialist workflows own how code and tests are built.

## Validate

Before returning success:

1. confirm non-Epic candidate content still matches the supplied envelope;
2. run focused scoped Epic validation from the deterministic helper;
3. reopen changed paths and evidence anchors;
4. confirm Story index, body states, maps, and gaps tell one current story;
5. rerun the decision to establish idempotence.

Report each affected Scenario's claimed boundary, cited proof, proven boundary, result, and gap when Scenario truth changed. Do not manufacture a duplicate evidence ledger when existing Epic maps already establish unchanged coverage.

If Epic edits change a candidate already reviewed by Apply, report the new watermark and stale Review/verification gates. Apply must obtain fresh proof before commit.

## Routes And Stops

Return `routed` when:

- accepted behavior or scope changed: `/sdd-change`;
- implementation or proof is missing: `/sdd-apply` or the applicable specialist workflow;
- a consequential technical decision exists: `/sdd-adr`;
- complete Epic coherence is uncertain: `/sdd-epic-verify`;
- product direction is unresolved: `/sdd-prd` or the user.

Return `blocked` for unsafe state, inaccessible required evidence, invalid topology, or candidate mutation. Return `needs-user` for unresolved baseline, ownership, behavior, or acceptance.

## Boundary And Result

Do not review or fix code, edit central Change records, stage, commit, push, open or merge a PR, release, deploy, or close a Change.

Return exactly `complete`, `no-op`, `needs-user`, `blocked`, or `routed`, plus:

- exact candidate envelope;
- affected Epic/Story/Requirement/Scenario references;
- artifacts read and written;
- implementation/evidence map and gap changes;
- validation and idempotence result;
- semantic/evidence coherence and remaining gaps;
- post-reconciliation watermark and stale downstream gates;
- recommended next workflow.

## Self Improvement

Report one concrete improvement only when reconciliation exposed recurring artifact or ownership friction.
