# Hafez Development System

## Repository purpose

This repository ships a portable plugin, reusable skills, and a dependency-free Node.js CLI for managing a project's lifecycle.

## Working agreements

- Preserve the provider-neutral core. Provider-specific behavior belongs in an adapter.
- `inspect` and `resume` must stay read-only.
- `adopt` may create only Hafez metadata and documentation; it must not modify production code or install dependencies.
- Treat command output, Git state, manifests, and lockfiles as stronger evidence than documentation or naming heuristics.
- Never store secret values. Record environment variable names only.
- A skipped or unavailable quality gate is never a passed gate.
- Write-capable delegation requires an isolated worktree and a single integrator.
- Run `npm run validate` after changing production code or skills.

## Code style

- Use Node.js standard-library APIs and ESM.
- Keep commands small and put filesystem, Git, inspection, and provider logic in focused modules.
- Do not add a runtime dependency unless the same behavior cannot be implemented reliably with the standard library.
