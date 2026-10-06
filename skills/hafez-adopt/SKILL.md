---
name: hafez-adopt
description: Add resumable Hafez project state and operating documentation to an existing repository without restructuring production code, installing packages, or running migrations.
---

# Hafez Adopt

Inspect first. With the CLI, show the inferred focus using `hafez adopt <path>`, then apply reviewed
writes using `hafez adopt <path> --apply`. In a skills-only installation, preview the exact allowed
paths and create the minimal state described in [references/minimal-state.md](references/minimal-state.md)
only after the user asks to adopt the project.

Adoption may create only `.hafez/`, `docs/hafez/`, and a missing root `AGENTS.md`. Preserve existing files and make repeated adoption idempotent. Do not install dependencies, run migrations, rewrite architecture, or modify application code.

After adoption:

- Record open questions instead of guessing product decisions.
- Model incomplete work per capability and repository.
- Add gradual migration recommendations when conventions are inconsistent.
- Run `hafez resume` to confirm a fresh agent can understand the next action.

Read [references/adoption-contract.md](references/adoption-contract.md) before adopting a dirty, legacy, or multi-repository project.
