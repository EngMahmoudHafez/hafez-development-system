---
name: hafez-verify
description: Run the project-defined quality gates, record durable evidence, and determine readiness without treating skipped or unavailable checks as success.
---

# Hafez Verify

Run `hafez verify <path>` to preview configured commands, then use `--execute`, when the CLI is
available. In a skills-only installation, read the argument-array gates from `.hafez/project.json`,
show them before first execution, run them without shell interpolation, and record equivalent bounded
evidence under `.hafez/evidence/`.

- Use commands declared in `.hafez/project.json` or a detected adapter; never invent a destructive verification command.
- Record command, exit code, duration, and bounded output in `.hafez/evidence/`.
- Use `passed`, `failed`, `skipped`, or `unavailable` exactly.
- A release or completed slice requires every required gate to be `passed`.
- Diagnose failures; do not weaken tests, suppress errors, or replace real behavior with fixtures.

Read [references/gates.md](references/gates.md) before defining release or cross-repository contract gates.
