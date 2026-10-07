---
name: hafez-autopilot
description: Run a project continuously from its current state to the next verified milestone, automatically adopting safe Hafez metadata, fixing failures, delegating bounded work to helper models, reviewing their output, integrating approved changes, and stopping only at genuine decision or authority boundaries.
---

# Hafez Autopilot

Act as the lead integrator. The user should not have to drive the lifecycle manually.

Start with `hafez autopilot <path> --json` when the runtime is available. If the project is unmanaged, autopilot may create only Hafez operating metadata; it must not silently impose an architecture profile.

Before dispatching helpers, run `hafez delegation-plan <path> --json` when available. Use its zero-config topology unless the project has an explicit provider policy.

For an active slice, run `hafez dispatch-plan <path> --json` before manual delegation:
- if `needsDecomposition=true`, use `hafez-decompose` to persist structured work units in the active slice;
- otherwise run `hafez dispatch <path> --execute --json` to create and execute the currently dispatchable helper packets;
- feed each returned packet into `hafez delegation-cycle <task-id>` until it is reviewed/integrated/verified or reaches a real owner boundary;
- after each completed work unit, run `hafez dispatch-plan` again so newly unblocked dependencies can start.

Then loop until completion or a genuine decision boundary:

1. Read the returned next action, active slice, blockers, Git state, and required gates.
2. If the action is deterministic, let Hafez execute it.
3. If the action needs agent work, inspect the active slice's structured work units first. Perform lead-owned units yourself and delegate only the units Hafez marks dispatchable.
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


## Non-stop continuation contract

Do not surface an intermediate Hafez continuation state as a final user response.

The following outcomes mean **continue working immediately**:
- `lead-action-required`
- `continuation-budget-reached`
- `delegation-cycle-budget-reached`
- `worker-result-pending`
- `retry`
- `escalate`
- `lead-review-required`
- `lead-takeover-required`
- `post-integration-verification-failed`
- failed/unavailable/skipped required gates that are technically repairable
- technical blockers or non-material open questions

For those outcomes, inspect the returned evidence, take the next action, and call Hafez again. Do not ask the project owner for routine implementation guidance.

Only surface a blocking question when Hafez classifies it as an owner decision because it materially changes product/business behavior, architecture/public contracts, requires external authority/credentials, or is destructive/difficult to recover.

A verified milestone may be reported to the user, but if the active project goal clearly has more in-scope work recorded, resume the loop instead of treating the milestone as the end of the project.


## Non-stop host loop

Treat these runtime outcomes as internal continuation signals, not user-facing stopping points:

- `lead-action-required`: the lead performs the bounded action, records the result, then immediately runs `hafez start <path> --json` again.
- `continuation-budget-reached`: immediately start another bounded cycle from durable state.
- `delegations-dispatched`, `scout-evidence-ready`, `delegation-integrated-and-verified`, and other outcomes with `continuationRequired: true`: consume the result and continue the loop.
- failed tests, rejected reviews, provider failures, unavailable helpers, and recoverable merge/verification failures: debug, retry, fail over, escalate, or let the lead take over.

Return control to the project owner only when Hafez records `waitingForOwner: true`, or when the project has no known runnable work and a verified final handoff has been created.

The lead must understand each worker result before choosing the next action. Never repeat a failed approach mechanically: carry forward the previous summary, blockers, review feedback, changed evidence, and retry tier.


## No-progress escalation

If Hafez reports `strategy-escalation-required`, do not ask the project owner. Treat it as an internal engineering escalation:

- `specialist`: change provider or use a higher-capability specialist, narrow the reproduction, and try a materially different approach.
- `lead`: the strongest available lead takes over the task directly, re-evaluates the assumptions and evidence, and changes strategy.

A repeated result without new Git state, gate evidence, or slice progress is not progress. Do not keep retrying the same prompt or patch.
