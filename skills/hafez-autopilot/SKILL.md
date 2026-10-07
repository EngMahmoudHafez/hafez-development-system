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
8. After every worker result or lead review, run `hafez delegation-next <task-id> --json` and obey the continuation decision:
   - `retry`: re-dispatch the same bounded task at the returned attempt;
   - `escalate`: re-dispatch it at the returned stronger worker tier;
   - `review`: review the exact revision;
   - `integrate`: integrate the approved revision;
   - `lead-takeover`: stop delegating and let the lead repair/implement directly;
   - `owner-decision`: pause and ask the project owner.
9. A rejected or failed worker is not a reason to stop. Clean up its abandoned worktree/reservation, preserve the reason in the next packet, and continue using the returned retry/escalation decision.
10. Integrate only approved results with `hafez delegation-integrate <task-id>`.
11. Treat integration as provisional until required gates pass on the integration tree. `hafez delegation-cycle` must run post-integration verification automatically.
12. If post-integration verification fails, route directly to `hafez-debug`, repair the integration tree, and rerun required gates without asking the owner.
13. Re-run `hafez autopilot <path> --json` after every meaningful transition.

Do not stop merely because a test fails, a linter reports issues, a worker fails, or a recoverable merge/review problem appears. Repair or re-delegate first.

Stop only for:
- a material product decision with multiple valid outcomes;
- credentials, production authority, payment, publishing, or external communication;
- destructive or difficult-to-recover work;
- a conflict that cannot be resolved safely from repository evidence;
- exhausted available providers when the task cannot be completed by the lead.

Use the repository state, Git, tests, contracts, and command evidence as truth. Never treat worker self-reports as sufficient proof.


## Continuous-loop rule

Default to continuation, not interruption. Technical uncertainty is resolved by inspection, scouts,
tests, narrower experiments, retries, escalation, or lead takeover. Do not ask the project owner to
choose between implementation details that can be decided from repository evidence.

The owner is consulted only when Hafez identifies a material boundary: product behavior with multiple
valid outcomes, credentials or production authority, payment/publishing/external communication,
destructive work, or an explicit architecture choice whose trade-off belongs to the owner.

If the host session ends for any non-decision reason, leave durable state/handoff so the next session
resumes the same loop rather than treating interruption as approval to stop.
