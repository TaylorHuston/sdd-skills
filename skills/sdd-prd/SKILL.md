---
name: sdd-prd
description: Create, draft, update, review, or reason about private project planning Product Briefs/PRDs and Feature/Capability Briefs for SDD application projects in project planning docs through a lightweight grill-me style product interview. Use when the user invokes /sdd-prd, asks whether a SDD project needs product direction before SDD changes, refines SDD product scope, audience, principles, market/monetization, non-goals, or open questions, or checks drift between PRD direction and SDD changes, Epic directories, embedded Stories, Requirements, Scenarios, implementation, or review results. PRDs are optional for early experiments and expected once a project has momentum beyond experimentation.
---

# SDD Product Brief / PRD

Treat a Product Brief/PRD as durable private product direction above the SDD change workflow. Keep it high-level enough to guide `/sdd-change --brief`, later Change planning, Epic scope, Story shape, and scope tradeoffs without becoming a roadmap, implementation spec, status page, worklog, or SDD change artifact.

## Authority And Project Profile

Resolve the workspace, idea-owned planning path, and mapped implementation repositories with `sdd context <relevant-path> --json`, then read `<workspaceRoot>/.sdd/story-driven-development.md` completely before interpreting the PRD's relationship to Epics and changes. Use the resolved topology unless project guidance declares an explicit exception. The default PRD is `<planningPath>/prd.md`; project guidance still owns filenames, frontmatter, privacy boundaries, interview/write authorization, and related product-doc conventions. Referenced Epics and changes use the canonical repository `docs/` layout inside each affected implementation repository. If the managed workflow document is missing, stop and direct the user to `sdd init` or `sdd doctor`.

Use the smallest document that can keep future humans and agents aligned.

## SDD Relationship

The normal ladder is:

```text
sdd-explore -> sdd-prd -> sdd-change --brief -> sdd-change --plan -> promote -> sdd-apply -> sdd-review -> optional PR/merge/close
```

`sdd-prd` is not required for early experiments. Suggest creating or refreshing a PRD when the project has momentum beyond experimentation, recurring product decisions, multiple Epics or SDD changes, unclear audience/scope/principles, public or monetization implications, or repeated product drift.

Use this boundary:

| Artifact | Owns |
|---|---|
| `<planning-root>/prd.md` | product purpose, audience, scope, principles, product-level capability areas, market/monetization, open product questions |
| `docs/changes/yyyy-mm-dd-change-name/proposal.md` | why this specific change exists and what Epic actions it proposes |
| `docs/changes/yyyy-mm-dd-change-name/design.md` | high-level technical approach plus proposed Epic/Story/Requirement/Scenario changes |
| `docs/changes/yyyy-mm-dd-change-name/tasks.md` | implementation ledger, resume state, verification ledger, and closeout state |
| `docs/epics/<key>-<###>-<epic-name>/epic.md` | durable capability/Epic truth, embedded Stories, Requirements, Scenarios, code map, verification map, gaps |
| `docs/changes/yyyy-mm-dd-change-name/review.md` | change-local review findings when `sdd-review` is not clean |

`/sdd-change --brief` and `--plan` should read the PRD when available and flag drift. `/sdd-apply` should stop when implementation reveals meaningful product drift. `/sdd-review` should include a lightweight PRD alignment check when product scope changed.

## Locations

Create or update the canonical PRD at:

```text
<planning-root>/prd.md
```

Create optional Feature or Capability Briefs only when a PRD would otherwise become too heavy:

```text
<planning-root>/features/<feature-slug>.md
```

Do not create PRDs or Feature Briefs in public app repositories unless the user explicitly asks.

## Workflow

PRD work is conversation-first. Run a lightweight `grill-me` style process before durable product direction is written. Do not create or patch a PRD immediately after context gathering unless the user explicitly asks for a direct write, import, cleanup, or mechanical update.

Treat synthesis and write permission as separate gates:

- A user saying "proceed", "sounds good", "continue", or similar after a recommendation means continue the interview or synthesis unless they clearly ask to write, create, patch, update, save, persist, or record the PRD.
- Before writing a new PRD or materially changing an existing PRD, present the current synthesis and ask for explicit confirmation to persist it unless the user has already given a direct write instruction.
- Do not treat your own recommendation as authority to write durable product direction.

Steps:

1. Inspect relevant existing context first.
   - Read current `prd.md`, older `project-brief.md`, project folder note, README, app docs, active and closed `docs/changes/`, legacy `changes/` when present, `docs/epics/*/epic.md`, `review.md` files, and code only when they materially inform product direction.
2. Infer what can be inferred before asking questions.
3. Start the lightweight product interview.
   - Ask one high-leverage product question at a time.
   - Include a concise recommended answer or framing with each question.
   - Prefer questions that materially change direction, scope, audience, principles, market assumptions, monetization, related PRD boundaries, or open questions.
   - If the answer can be discovered from existing docs, SDD changes, Epic files, implementation, or code, inspect those sources instead of asking.
4. Keep a working synthesis in the conversation.
   - Known context.
   - Inferred direction.
   - Unresolved product decisions.
   - Candidate PRD shape.
5. Patch durable product direction only when the user explicitly asks to write/update the PRD or clearly confirms the synthesized direction is ready to record after an explicit persistence check.
6. Record unresolved product uncertainty as `TBD`, `Unknown`, `Not applicable`, or an Open Question instead of inventing certainty.
7. Report duplicate-truth, stale-PRD, or PRD-drift recommendations separately from the document edit.

## New PRDs

Use `assets/canonical-prd-template.md` as the SDD starting point for new PRDs. Adapt lightly to nearby vault conventions.

Use minimal semantic frontmatter:

```yaml
---
created: YYYY-MM-DD
modified: YYYY-MM-DD
last_reviewed: YYYY-MM-DD
---
```

Set `last_reviewed` only after a real product-direction review of vision, audience, scope, principles, core capabilities, market assumptions, and open questions. Do not update it for formatting, typo fixes, link maintenance, or metadata cleanup.

Do not add `status` by default. Preserve existing Obsidian/vault fields that support local functionality, such as `aliases`, `tags`, `class`, `cssclasses`, or `archived`.

When a project has an older brief but no canonical `prd.md`, treat the older brief as source context. Do not create `prd.md` immediately. First summarize what the older brief appears to say, identify decisions that need the user's input, and begin the product interview. Create `prd.md` only after the user asks to write it or confirms the synthesized product direction is ready to record.

## PRD Boundaries

Include:

- elevator pitch
- problem or opportunity
- primary users
- core outcomes
- current product-facing scope
- non-goals
- durable product principles
- core functionality at product-capability level
- related Product Briefs when suite, platform, companion-product, or sub-product context matters
- market, competition, and monetization notes when relevant
- product-level open questions

Exclude by default:

- product/project maturity or status
- active branch, sprint, roadmap, milestone, phase, or delivery sequencing
- GitHub, Vercel, Convex, deployment, or operational links
- repo paths and project navigation metadata
- Epic, Story, Requirement, or Scenario indexes
- SDD change folders, implementation ledgers, review reports, or task plans
- ordinary framework, package, database, hosting, schema, API, or config details
- task plans, changelogs, worklogs, or session notes

Place project status, operational navigation, links, and repo metadata in the project folder note or README instead.

## Product Level

Keep `Core Functionality` at the level used to explain the product. Do not turn it into route lists, CRUD tasks, database shapes, Requirements, Scenarios, or implementation checklists.

Include technical traits only when they define the product promise, such as `local-first`, `filesystem-backed`, `AI-native`, `persistent-memory`, `privacy-first`, `auditable`, `provenance-preserving`, `Obsidian-vault-native`, or `offline-capable`.

If a conversation drifts into exact metadata keys, config storage, parser choices, plugin APIs, permission mechanics, deployment mechanics, or implementation sequencing, capture only the product-level principle in the PRD and recommend `design.md`, an ADR, an Epic `epic.md`, or `tasks.md` for the implementation details.

## Feature Briefs

Create a Feature or Capability Brief only when:

- a capability concept spans multiple Epics
- a core capability needs more product explanation than the PRD should carry
- future agents repeatedly need product terminology, product rules, or non-technical flow context
- non-goals or product tradeoffs matter across multiple SDD changes
- technical traits are integral to the capability's product identity

Do not create Feature Briefs for content that fits cleanly in one Epic `epic.md` or one `design.md`.

Use only sections that make the brief useful:

```markdown
# <Feature / Capability> Brief

## Purpose

## User Need

## Product Behavior

## Key Concepts

## Scope

## Non-Goals

## Important Flows

## Product Rules

## Open Questions
```

## Drift

Notice PRD drift during `sdd-explore`, `sdd-change`, `sdd-apply`, `sdd-review`, acceptance, and status work. Suggest a PRD revisit when implementation, testing, dogfooding, target users, scope boundaries, principles, market assumptions, monetization assumptions, or recurring decisions diverge from written product direction.

Treat implementation and Epic truth as current behavioral reality. Treat the PRD as directional product intent. A valid drift-review outcome is `reviewed; no PRD change needed`.

When drift is found:

- If product intent changed, recommend updating `prd.md`.
- If a proposed SDD change conflicts with product direction, flag the conflict before `/sdd-change --plan` or `/sdd-review` proceeds.
- If the PRD is intentionally broader than current implementation, leave it alone and make current implementation state clear in Epic/change artifacts.

## Completion Check

Before reporting a PRD or Feature Brief update complete, verify:

- the correct private vault path was used
- relevant existing product and SDD context was inspected
- frontmatter is minimal and `last_reviewed` reflects a real product-direction review
- the PRD stayed product-level
- technical traits are product-defining
- project status, links, metadata, roadmaps, Epic/Story/Requirement/Scenario detail, tasks, and implementation details stayed out of the PRD
- open questions are product-level
- Feature Briefs were created only when they reduce PRD weight or cross-Epic duplication

## Final Response

Summarize:

- whether the PRD was created, updated, reviewed, or left unchanged
- product decisions captured
- open questions
- SDD drift findings, if any
- recommended next workflow, usually `/sdd-change --brief` when a bounded outcome is worth retaining or `/sdd-change --plan` when implementation planning should begin now
