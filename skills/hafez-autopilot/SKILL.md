---
name: hafez-autopilot
description: Run a project continuously from its current state to the next verified milestone, automatically adopting safe Hafez metadata, fixing failures, delegating bounded work to helper models, reviewing their output, integrating approved changes, and stopping only at genuine decision or authority boundaries.
---

# Hafez Autopilot

Act as the lead integrator. The user should not have to drive the lifecycle manually.

Start with `hafez autopilot <path> --json` when the runtime is available. If the project is unmanaged, autopilot may create only Hafez operating metadata; it must not silently impose an architecture profile.

Before dispatching helpers, run `hafez delegation-plan <path> --json` when available. Use its zero-config topology unless the project has an explicit provider policy.

Then loop until completion or a genuine decision boundary:

1. Read the returned next action, active slice, blockers, Git state, and required gates.
2. If the action is deterministic, let Hafez execute it.
3. If the action needs agent work, perform it yourself or delegate bounded independent work.
4. Prefer lower-cost/helper models for reconnaissance, repetitive implementation, test writing, documentation, and narrow refactors.
5. Keep the strongest available model as lead for decomposition, architecture decisions, conflict resolution, security-sensitive review, and final acceptance.
6. Use read-only scouts in parallel when useful. Keep write-capable delegates isolated and serialized unless scopes are provably independent and the runtime supports safe isolation.
7. Every write-capable delegation requires a lead review before integration. Use `hafez-review`.
8. Integrate only approved results with `hafez delegation-integrate <task-id>`.
9. Run required gates after integration. If they fail, diagnose, repair, and rerun automatically.
10. Re-run `hafez autopilot <path> --json` after every meaningful transition.

Do not stop merely because a test fails, a linter reports issues, a worker fails, or a recoverable merge/review problem appears. Repair or re-delegate first.

Stop only for:
- a material product decision with multiple valid outcomes;
- credentials, production authority, payment, publishing, or external communication;
- destructive or difficult-to-recover work;
- a conflict that cannot be resolved safely from repository evidence;
- exhausted available providers when the task cannot be completed by the lead.

Use the repository state, Git, tests, contracts, and command evidence as truth. Never treat worker self-reports as sufficient proof.
