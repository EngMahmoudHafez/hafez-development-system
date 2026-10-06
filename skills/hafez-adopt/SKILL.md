---
name: hafez-adopt
description: Add resumable Hafez project state and operating documentation to an existing repository without restructuring production code, installing packages, or running migrations.
---

# Hafez Adopt

Inspect first, show the user the inferred focus with `hafez adopt <path>`, then apply the reviewed writes with `hafez adopt <path> --apply`.

Adoption may create only `.hafez/`, `docs/hafez/`, and a missing root `AGENTS.md`. Preserve existing files and make repeated adoption idempotent. Do not install dependencies, run migrations, rewrite architecture, or modify application code.

After adoption:

- Record open questions instead of guessing product decisions.
- Model incomplete work per capability and repository.
- Add gradual migration recommendations when conventions are inconsistent.
- Run `hafez resume` to confirm a fresh agent can understand the next action.

Read [references/adoption-contract.md](references/adoption-contract.md) before adopting a dirty, legacy, or multi-repository project.
