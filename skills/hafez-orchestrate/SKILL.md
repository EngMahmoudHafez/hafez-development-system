---
name: hafez-orchestrate
description: Route a software project from discovery through delivery, or recover and continue a partially built project using Hafez state, evidence, slices, verification, and handoffs. Use for end-to-end project work or when the correct current phase is unclear.
---

# Hafez Orchestrate

Start by establishing facts, not by choosing an architecture.

1. If `.hafez/state.json` is absent, use `hafez-inspect`; use `hafez-adopt` only when the user wants durable project state.
2. If state exists, use `hafez-resume` before proposing work.
3. Choose one current focus: discovery, foundation, delivery, integration, hardening, release, or operation.
4. Plan end-user capabilities as vertical slices with `hafez-plan-slice`.
5. Delegate only independent work with `hafez-delegate`; keep one integrator for shared files.
6. Use the matching stack adapter when detected. Stack guidance never overrides observed project conventions.
7. Run `hafez-verify` before claiming completion and `hafez-handoff` whenever work pauses or changes owner.

Treat code, Git, lockfiles, contracts, and command output as stronger evidence than documentation. Never convert `skipped` or `unavailable` into success.

Use `hafez skills <path> --json` to discover project, user, and bundled skills. Read [references/skill-routing.md](references/skill-routing.md) before combining lifecycle, stack, review, or Superpowers workflows.

Read [references/lifecycle.md](references/lifecycle.md) when choosing between phases or coordinating multiple repositories.
