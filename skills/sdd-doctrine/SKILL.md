---
name: sdd-doctrine
description: Load and apply the portable Story-Driven Development doctrine shared by the SDD skill suite. Use when another SDD skill needs authoritative definitions for artifact roles, Epic and Story truth, Requirements and Scenarios, evidence, change lifecycle, review, reconciliation, or the boundary between core SDD semantics and project-specific operating policy. This is a support skill and does not create artifacts by itself.
---

# SDD Doctrine

Provide the portable semantic contract for the SDD skill suite.

Read `references/story-driven-development.md` completely before interpreting or enforcing SDD artifact authority, traceability, evidence, lifecycle, or closeout rules.

## Authority

- The doctrine owns portable SDD semantics, invariants, the default idea-to-repository relationship model, and the canonical repository artifact layout under `docs/`.
- The active workflow skill owns the procedure for its action.
- Project and workspace guidance own explicit exceptions to the default idea/repository model, branch and merge policy, commands, release conventions, non-SDD supporting-doc requirements, technology constraints, available tools, and local preferences.
- Templates own canonical artifact shape where the doctrine intentionally stays semantic.

When these layers disagree, preserve higher-priority instructions and project safety, then report or repair the drift. Do not reinterpret a project-specific preference as a universal SDD requirement, and do not let project customization relocate canonical SDD artifacts or weaken artifact authority, traceability, evidence honesty, or reconciliation while claiming SDD compliance. A deliberately different idea/repository model should be declared in project guidance or changed in the doctrine's `Default Idea-To-Repository Relationship` section for a package-wide customization. A different repository-internal SDD layout requires editing the doctrine, affected skills, and templates together.

This support skill does not write files, run commands, or produce a separate report unless the user explicitly asks to inspect or revise the doctrine itself.
