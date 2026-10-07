---
name: hafez
description: Route a software project from discovery through delivery, or recover and continue a partially built project using Hafez state, evidence, slices, verification, and handoffs. Use for end-to-end project work or when the correct current phase is unclear.
---

# Hafez

Start by establishing facts, not by choosing an architecture.

Users do not need to know Hafez commands or sub-skill names. Translate natural requests into the
matching workflow yourself. Use the CLI when it is available; otherwise follow the same inspection,
state, planning, verification, and handoff contracts directly.

- "Start this project" or "What should we do next?" routes to inspection, then offers adoption.
- "Continue" or "Pick up where we stopped" routes to resume.
- "Keep going", "finish whatever is left", "fix errors and continue", or "run this project autonomously" routes to `hafez-autopilot`.
- Reproducible failures route to `hafez-debug`; delegated writes route through `hafez-review` before integration.
- "Build this feature" routes to resume or adopt, then one vertical slice and its stack adapter.
- Multi-part active slices route through `hafez-decompose` before write delegation so the lead can assign safe bounded work units.
- "Is this ready?" routes to verification and an evidence-based readiness answer.
- "Give this to another model" routes to bounded delegation and a durable handoff.
- "Coordinate these repositories" routes to an explicit `hafez-workspace` graph; names and paths are
  never treated as architecture.

Continue through reversible in-scope implementation and local verification without asking for routine
confirmation. Pause only at the decision boundaries recorded by the project or when new authority is
required.

When the runtime is available, use `hafez run <path>` to obtain the bounded next action. The host
agent performs queued planning or implementation, records the result, and runs it again. Use
`--execute` only for deterministic configured gates and handoffs; the CLI does not contain a model and
must pause before agent-owned work.

1. If `.hafez/state.json` is absent, use `hafez-inspect`; use `hafez-adopt` only when the user wants durable project state.
2. If state exists, use `hafez-resume` before proposing work.
3. Choose one current focus: discovery, foundation, delivery, integration, hardening, release, or operation.
4. Plan end-user capabilities as vertical slices with `hafez-plan-slice`.
5. Use `hafez-decompose` when a slice has several independently verifiable concerns; then delegate independent work with `hafez-delegate`.
6. Keep the strongest available model as lead integrator and use cheaper/helper models for bounded work.
7. Require `hafez-review` approval for write-capable delegated revisions before deterministic integration.
8. Use the matching stack adapter when detected. Stack guidance never overrides observed project conventions.
9. Use `hafez-debug` for recoverable failures, then run `hafez-verify` before claiming completion and `hafez-handoff` whenever work pauses or changes owner.
10. Use `hafez-workspace` when one capability crosses repository boundaries.

Treat code, Git, lockfiles, contracts, and command output as stronger evidence than documentation. Never convert `skipped` or `unavailable` into success.

Use `hafez skills <path> --json` to discover project, user, and bundled skills when the CLI is available. Read [references/skill-routing.md](references/skill-routing.md) before combining lifecycle, stack, review, or Superpowers workflows.

Read [references/lifecycle.md](references/lifecycle.md) when choosing between phases or coordinating multiple repositories.
