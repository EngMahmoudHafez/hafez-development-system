# Hafez lifecycle model

## Workflow state

`unmanaged → inspected → adopted → planned → in-progress → verifying → ready → handed-off`

Failure may move work to `blocked`. A handoff may be created from planned, in-progress, blocked, or ready work.

## Current focus

- `discovery`: clarify product intent, inventory reality, or resolve low-confidence facts.
- `foundation`: establish the minimum architecture and quality gates needed for safe delivery.
- `delivery`: implement a bounded vertical capability.
- `integration`: connect repositories, contracts, mocks, providers, or deployment surfaces.
- `hardening`: repair security, reliability, performance, test, or operational gaps.
- `release`: prove release readiness and produce deployment evidence.
- `operation`: observe production, respond to incidents, and maintain runbooks.

Focus may move backward when evidence changes. A deployed product can return to hardening.

## Capability status

Track status per capability and repository: `unknown`, `absent`, `specified`, `mocked`, `implemented`, `integrated`, `verified`, `released`, or `degraded`.

Do not reduce these states to one project-completion percentage.


## Continuous decision loop

Autopilot treats recoverable technical uncertainty as work, not as a stopping boundary.

Continue automatically through:
- failed or unavailable technical gates that can be repaired locally;
- provider failure and model retry/failover;
- rejected delegated revisions;
- worker → specialist → lead escalation;
- non-material implementation questions that repository evidence can answer;
- post-integration verification failures.

Pause only for a project-owner decision that materially changes product/business behavior, architecture or public contracts, requires external authority/credentials, or is destructive/difficult to recover.

When paused, the exact decision context is persisted in `.hafez/autopilot.json` so a fresh session does not need chat history to understand why the loop stopped.
