---
name: hafez-resume
description: Resume work in a Hafez-managed project by reconciling saved state with current Git evidence, gates, capabilities, blockers, and the latest handoff.
---

# Hafez Resume

Run `hafez resume <path> --json` before continuing work when the CLI is available. In a skills-only
installation, read `.hafez/project.json`, `.hafez/state.json`, the latest handoff, current Git status,
and current gate evidence directly before selecting the next action.

Report:

- current workflow state and focus;
- active slice and capability gaps;
- Git drift or uncommitted changes since the last known-good revision;
- failed or unavailable required gates;
- blockers and open questions;
- exactly one recommended next safe action.

Do not trust a stale handoff over the current working tree. If state is missing, route to `hafez-inspect` and offer adoption. Never write files during resume.
