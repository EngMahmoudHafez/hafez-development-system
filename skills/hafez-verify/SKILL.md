---
name: hafez-verify
description: Run the project-defined quality gates, record durable evidence, and determine readiness without treating skipped or unavailable checks as success.
---

# Hafez Verify

Run `hafez verify <path>` to preview the configured commands. After confirming they are appropriate for the repository, run `hafez verify <path> --execute`.

- Use commands declared in `.hafez/project.json` or a detected adapter; never invent a destructive verification command.
- Record command, exit code, duration, and bounded output in `.hafez/evidence/`.
- Use `passed`, `failed`, `skipped`, or `unavailable` exactly.
- A release or completed slice requires every required gate to be `passed`.
- Diagnose failures; do not weaken tests, suppress errors, or replace real behavior with fixtures.

Read [references/gates.md](references/gates.md) before defining release or cross-repository contract gates.
