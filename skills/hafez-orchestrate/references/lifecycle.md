# Lifecycle model

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
