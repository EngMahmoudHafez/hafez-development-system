---
name: hafez-handoff
description: Create a durable project handoff when work pauses, changes owner, becomes blocked, or reaches a verified release checkpoint.
---

# Hafez Handoff

Run `hafez handoff <path>` whenever continuity matters when the CLI is available. In a skills-only
installation, write the same contract directly to a timestamped file under `docs/hafez/handoffs/` and
update the handoff pointer in `.hafez/state.json`. A handoff is allowed from planned, in-progress,
blocked, or ready work.

Include revision, branch, dirty files, active slice, completed and incomplete work, decisions, gate evidence, blockers, risks, and one next safe action. Never claim release readiness when a required gate is failed, skipped, unavailable, or stale.

Read [references/handoff-contract.md](references/handoff-contract.md) for multi-repository and blocked-work handoffs.
