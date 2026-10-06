---
name: hafez-inspect
description: Inspect an unfamiliar or partially built repository, infer its stack and current project focus from evidence, and recommend the next safe action without changing files.
---

# Hafez Inspect

Run `hafez inspect <path> --json` before planning changes in an unmanaged or unclear repository.

- Keep the inspection read-only.
- Separate observed facts from inferences and attach paths or command evidence.
- Detect stack, Git state, tests, CI, contracts, deployment assets, project guidance, and existing Hafez state.
- When documentation conflicts with code or a current command result, report the conflict and prefer the stronger evidence.
- For unknown stacks, return a generic inventory and lower confidence; do not invent commands or recommend a rewrite.

Read [references/evidence-model.md](references/evidence-model.md) when ranking conflicting evidence or making phase recommendations.
