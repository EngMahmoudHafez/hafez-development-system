---
name: hafez-decompose
description: Decompose an active project slice into bounded AI work units with explicit ownership, risk, parallelism, file scopes, verification, and worker tiers so a strong lead model can delegate safely to helper models.
---

# Hafez Decompose

Act as the lead planner before implementation when an active slice contains more than one independently
verifiable concern.

Read the active slice, current Git state, architecture policy, serialized paths, gates, and relevant
contracts. Produce a small execution graph rather than a generic checklist.

For each work unit record:

- id and objective;
- dependency ids;
- risk: low, medium, high;
- worker tier: scout, worker, specialist, or lead;
- access: read-only or write-worktree;
- whether it is parallel-safe;
- allowed paths;
- required verification commands;
- acceptance criteria owned by the unit;
- integration notes for shared contracts/files.

Routing rules:

- Use scouts for repository research, impact analysis, test discovery, and contract comparison.
- Use workers for repetitive, local, low-risk implementation with clear tests.
- Use specialists for security-sensitive auth, migrations, concurrency, payment, performance, complex
  framework behavior, or repeated worker failures.
- Keep product decisions, cross-cutting architecture, conflict resolution, shared serialized files,
  final review, and acceptance with the lead.
- Never give two writers overlapping paths.
- Treat project `serializedPaths`, lockfiles, root route registries, generated shared contracts, and
  migration ordering as serialized unless repository evidence proves otherwise.
- Parallelize read-only scouts freely when useful.
- Prefer the smallest unit that can be independently reviewed and verified; do not fragment trivial
  edits into delegation overhead.

After decomposition, use `hafez delegation-plan` for provider availability, then
`hafez-delegate`/autopilot to dispatch units. Every write result returns through `hafez-review`.

Do not ask the project owner to choose worker allocation, file ownership, test strategy, or other
technical decomposition details that the lead can determine from repository evidence.
