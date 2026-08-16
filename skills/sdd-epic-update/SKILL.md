---
name: sdd-epic-update
description: Reconcile repository-owned SDD Epic, Story, Requirement, Scenario, implementation-map, gap, and verification-map truth against one exact committed or working-tree candidate. Use after implementation or review, after manual behavioral work, for traceability-only drift, or whenever the user asks to update an Epic from actual code. Works with or without an active Change or Apply history, mutates only Epic truth and directly owned generated indexes, and stops before code review, code fixes, Change lifecycle changes, changelog work, commits, PRs, release, or deployment.
---

# SDD Epic Update

Update the durable behavior-to-code map for one exact candidate. This public mutation capability may be invoked directly or composed by Apply after a clean slice Review; composition does not create a private mode or make Apply history mandatory. It is not a code review, implementation workflow, or full-Epic audit.

## Inputs

Accept:

```text
/sdd-epic-update [repository-or-epic-path] --baseline <commit-ish> [--candidate working-tree|<commit-ish>]
/sdd-epic-update [repository-or-epic-path] --change <change-id> [--slice S#]
/sdd-epic-update [repository-or-epic-path] --epic <epic-id>
```

The conceptual input is one shared diff envelope per repository:

- stable repository ID and resolved root;
- immutable baseline commit SHA;
- candidate kind: current working tree or explicit commit/ref;
- candidate SHA when committed, or HEAD plus staged, unstaged, and relevant untracked state for a working tree;
- optional Change ID, slice ID, Requirement references, Scenario references, review result, and durable verification evidence.

An active Change, selected slice, Apply session, or Implementation Ledger row is optional. Manual changes and traceability-only repairs are legitimate inputs; never fabricate Apply history merely to authorize Epic reconciliation. When Apply composes this capability, it supplies the selected slice, exact reviewed implementation envelope, Review result, and durable verification evidence through this same public contract.

When the baseline or candidate is ambiguous, return `needs-user`. Never infer that the target branch, merge base, previous commit, or current HEAD is the intended baseline without evidence from the caller, Change checkpoint, review envelope, or repository policy.

## Resolve The Candidate

1. Resolve workspace, Space, repository, artifact roots, and `workflowPath` with `sdd context <relevant-path> --json`; read the returned doctrine and all applicable workspace/repository `AGENTS.md` files.
2. Resolve an explicit Change through the top-level canonical inventory from `sdd status <space-id> --json`. Use `change.md` repository IDs and optional `tasks.md` slice references only as scope evidence, never as proof of implementation.
3. Establish the exact envelope. Prefer the deterministic helper:

   ```bash
   sdd epic update-input <repository-path> \
     --baseline <commit-ish> \
     --candidate <working-tree-or-commit-ish> \
     --workspace <workspace-root> \
     --json
   ```

   It resolves refs to immutable SHAs, rejects non-ancestor committed ranges, inventories committed or staged/unstaged/untracked changed paths, and returns the configured Epic root plus the scoped validation command. It does not select affected behavior or mutate files.
4. For a working-tree candidate, preserve unrelated dirty work and distinguish pre-existing edits when the supplied envelope identifies them. Return `blocked` when overlapping state makes attribution unsafe.
5. Record the initial implementation-input watermark. Re-resolve immediately before writing; any application, test, configuration, or unrelated candidate change makes reconciliation stale. Owned Epic/index edits intentionally produce a distinct post-reconciliation repository watermark and do not invalidate the unchanged implementation input.

Multi-repository Changes require one independently resolved envelope and one result block per repository. Never combine repositories into one guessed baseline.

## Determine Affected Behavior

Derive affected behavior from actual implementation, not filenames alone:

1. Inspect every changed path and behavior-bearing hunk in the envelope, including deletions, renames, tests, schemas, configuration, generated contracts, migrations, routes, registrations, adapters, and supporting docs.
2. Trace changed public or behavior-owning symbols through materially relevant callers, consumers, registrations, persistence, contracts, and focused tests.
3. Search existing Epics for changed anchors, full Story/Requirement/Scenario references supplied by the caller, legacy Story IDs, related tests, and behavior language.
4. Read enough neighboring Story and Epic truth to detect superseded assumptions, moved ownership, split boundaries, duplicate references, and cross-Story effects.
5. Classify each changed surface as:
   - behavior already owned by an affected Epic/Story;
   - implementation or evidence mapping only;
   - directly owned support/generated index;
   - internal-only with no Epic mutation needed;
   - undocumented behavior or deliberate behavior change that another workflow must own.

Do not run a repository-wide audit by default. Expand beyond the changed surface only where symbol propagation, existing references, or contradictory truth requires it. Use `/sdd-epic-verify` when the user asks whether the complete Epic is coherent or when confidence requires a full reverse-traceability audit.

## Reconciliation Rules

Mutate only repository-owned `epic.md` files under the configured Epic root and generated Epic indexes directly owned by repository guidance.

For every affected Story:

- Update the Epic Outcome, Current Scope, Story wording, Requirements, and Scenarios only when they describe behavior already established by the exact candidate and accepted intent.
- Keep Story `Implementation` and `Verification` independent and synchronize the Story Index with the Story body.
- Update `Implemented By` from inspected actual changed surfaces. Every implemented Requirement needs a concrete repository-relative governing location and stable symbol or searchable anchor, or an explicit `Implementation Gap`. Classify every behavior-bearing source/test candidate in the supplied diff/reverse-traceability inventory as mapped Epic ownership, supporting/generated/framework infrastructure, an explicit gap, another Epic, or tracked cleanup; do not let helper, policy, parser, formatter, or ownership-boundary files disappear merely because a higher-level caller is already mapped.
- Use narrower Requirement/Scenario rows when behavior ownership splits across routes, policy, persistence, configuration, migrations, presentation, or another governing boundary.
- Remove stale implementation rows, anchors, gaps, and superseded wording rather than retaining competing `Prior`, `Detailed`, or `Legacy` maps.
- Update `Verified By` only from durable evidence that directly proves the cited Requirement or Scenario on the exact candidate. Open the cited test or artifact, inspect the important assertion or observation, confirm any helper/formatter evidence reaches the production call site, and require interactive/rendered/live evidence to include a reproducible descriptor naming candidate, date, environment or fixture, actors/contexts, route or entry point, actions, observations, console/network outcome when applicable, and stable artifact path or content hash. A `/tmp` path, ephemeral browser profile, chat transcript, reviewer summary, screenshot hash without a retained artifact or reproducible procedure, or bare “local observation” phrase cannot be the sole passing evidence. Broad gates support confidence but do not substitute for Scenario proof. Enumerate the complete affected Scenario set rather than limiting reconciliation to recently repaired or previously disputed rows.
- Retain, add, or downgrade `Verification Gaps` when evidence is missing, stale, skipped, undiscovered, manual-only, live-only, boundary-mismatched, or weaker than the claim. Use canonical markers after the local Scenario reference: `[required]`, `[optional confidence:<durable-policy-reference>]`, `[manual acceptance]`, or `[user accepted YYYY-MM-DD]`. The dated user-accepted marker must match the Scenario closure and Slice Gate Ledger exactly; do not silently convert required technical proof into manual acceptance or omit a gap merely because deterministic evidence covers an adjacent boundary.
- Advance `last_verified` only when current durable evidence supports the resulting verification state. Do not turn a successful command into an unsupported Story-level `verified` claim.
- Reconcile earlier Stories whose assumptions the candidate supersedes; do not add only a new Story while leaving old truth contradictory.
- Normalize a materially edited legacy Epic to the current complete schema rather than partially mixing legacy and v2 shapes.
- Update generated Epic indexes only through their owning generator when repository guidance identifies one. Never hand-maintain generated output.

Artifact wording must describe current accepted implementation reality, not the Change plan or review narrative. Do not copy chronological commands, commit history, or implementation diaries into Epic evidence maps.

## Prove Semantic Closure

Before returning `complete` or `no-op`, compare each affected Story's Story Index row, body-level Implementation and Verification states, `Implemented By`, `Implementation Gaps`, `Verified By`, and `Verification Gaps`. Semantic closure fails when those surfaces tell different current-state stories, including when mapped behavior is still described in an index note or other current summary as not implemented or remaining work, passing evidence is also listed as a verification gap, the index and body states differ, or a partial state has no matching remaining gap. Fix owned contradictions within the same reconciliation; route contradictions outside the affected boundary to the appropriate owner.

Before marking an affected Scenario `passing` or a Story `verified`, classify the claimed boundary as backend/data, rendered interaction, live multi-context/realtime, provider/production, or manual acceptance. The cited evidence must exercise that same boundary: a later backend query does not prove an active subscription, source inspection does not prove rendered interaction, a helper return value does not prove rendered field feedback or focus, and direct confirmed/unconfirmed backend calls do not prove a user's confirmation/cancellation interaction. Pending manual acceptance is not technical verification. Weaker evidence remains a `Verification Gap` and keeps the Story `partial` or `unverified`.

Produce one Scenario Evidence Closure row for every affected Scenario with `Scenario`, `Claimed boundary`, `Cited proof`, `Proven boundary`, `Evidence type`, `Durability / reproduction reference`, `Result`, and `Gap classification`. Use machine-stable results `pass`, `accepted-gap`, `findings`, or `blocked` and gap values `none`, `required`, `optional-confidence:<durable-policy-reference>`, `manual-acceptance`, or `user-accepted:YYYY-MM-DD` so Apply can serialize the final closure certificate without interpreting prose. Every passing row must cite an anchored durable proof reference that also appears in the Story's passing `Verified By` evidence. Represent Epic `Verification Gaps` with exactly one Scenario-specific line and the matching marker—`[required]`, `[manual acceptance]`, `[optional confidence: <policy>]`, or `[user accepted YYYY-MM-DD]`—so deterministic validation can reject duplicates and classification drift. Require exact Scenario-set equality; missing, duplicate, improperly aggregated, extra, temporary-only, or otherwise non-durable rows fail evidence closure. A named required technical gap is honest but still prevents a completion-consuming `ready` result unless project policy makes it optional or the user explicitly accepts it with a date.

Report `Semantic closure: pass` and `Evidence closure: pass` only after independently proving them; a prior Review verdict, caller statement that evidence is closed, or prompt claim that only manual acceptance remains is untrusted input. Include the affected Story references, complete Scenario table, changed-surface classification, and remaining gaps. A scoped deterministic validation pass is necessary but cannot substitute for either comparison.

## Routes And Stop Conditions

Return `routed` without silently rewriting intent when:

- the candidate introduces new, disputed, or materially changed behavior not covered by accepted truth: route to `/sdd-change`;
- reconciliation reveals a consequential choice among viable technical approaches: route to `/sdd-adr`;
- implementation is missing or contradicts accepted behavior: route to `/sdd-apply` or the applicable implementation workflow;
- durable Scenario proof is insufficient and tests or runtime evidence must change: route to implementation/verification work;
- product direction is ambiguous or contradictory: route to `/sdd-prd` or the user;
- full-Epic completeness, reverse traceability, or coherence is in question: route to `/sdd-epic-verify`.

Return `blocked` for unsafe repository state, inaccessible required evidence, unresolved ownership, invalid artifact topology, or a candidate that changes during reconciliation. Return `needs-user` when baseline, candidate, affected behavior, acceptance, or product semantics cannot be resolved from evidence.

## Validate And Prove Idempotence

After editing each repository:

1. Confirm the implementation-input projection still matches the resolved envelope after excluding only the Epic/index mutations owned by this capability. If application code, tests, configuration, or unrelated files changed, return `blocked` and report the new candidate.
2. Run the scoped deterministic `validation.command` with its `validation.args` returned by `sdd epic update-input`; do not execute a display string through a shell. Narrow with `--epic <epic-id>` when exactly one Epic changed. Inspect warnings as well as errors.
3. Re-open every changed Epic mapping and confirm cited implementation and evidence paths/anchors exist and own the claimed behavior.
4. Re-run the reconciliation decision against the same candidate. A second invocation should normally produce no Epic/index changes and return `no-op`.
5. If a working-tree candidate watermark includes the Epic edits themselves, report both the implementation-input watermark and the post-reconciliation repository watermark. Do not falsely claim that pre-edit and post-edit working trees are identical.

Do not use a validation pass as proof that the behavioral interpretation is correct. The CLI verifies deterministic structure and envelope facts; this skill owns semantic reconciliation.

## Terminal Boundary

Stop after Epic/index reconciliation and validation. Do not:

- review implementation quality or issue a code-review verdict;
- modify application code, tests, schemas, migrations, or runtime configuration;
- write or alter `change.md`, `tasks.md`, `review.md`, or Change lifecycle state;
- write changelog or release-note content;
- commit, stage, push, open or merge a PR, release, deploy, or close a Change.

Recommend those as separately invoked workflows when applicable. When an active structured Change exists, report the fresh Epic-update candidate watermark so a direct caller or composing workflow can replace the `Epic-update candidate` checkpoint; do not edit that workspace-local checkpoint from this capability. A composing Apply invocation owns that checkpoint update after handling this result.

## Result Contract

Return exactly one composable status:

- `complete` — Epic/Story truth was reconciled and scoped validation passes for the exact candidate;
- `no-op` — inspected Epic truth already matches the exact candidate and no mutation was needed;
- `needs-user` — a baseline, candidate, ownership, product, or acceptance decision is required;
- `blocked` — safe reconciliation or required validation cannot complete;
- `routed` — Change, ADR, Apply/verification, PRD, or full Epic verification owns the discovered work.

Also report:

- one diff envelope per repository: repository ID/root, immutable baseline, candidate kind and watermark, and staged/unstaged/relevant-untracked state where applicable;
- optional Change, slice, Requirement, Scenario, and prior-review inputs used;
- affected Epics and Story/Requirement/Scenario references;
- artifacts read and written;
- implementation-map, gap, verification-map, and generated-index changes;
- scoped validation commands and results;
- semantic-closure and evidence-closure results, affected Story references, changed-surface classification, the complete Scenario Evidence Closure table including evidence type and durability/reproduction reference, and remaining gaps classified as required, optional confidence, manual acceptance, or dated user acceptance;
- idempotence result;
- post-reconciliation candidate watermark and any gates made stale;
- unresolved gaps, routes, blockers, and recommended next workflow.

## Self Improvement
After completing this skill ask yourself "what improvements to this skill could be made that would improve our overall SDD workflow?" Report any suggestions to the user.