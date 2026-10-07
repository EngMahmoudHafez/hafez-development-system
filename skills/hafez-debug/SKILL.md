---
name: hafez-debug
description: Diagnose and repair reproducible project failures continuously using evidence-first debugging, regression tests, bounded delegation, and repeated verification until the failure is fixed or a genuine external decision is required.
---

# Hafez Debug

Use this skill when a required gate, test, build, runtime check, migration, integration contract, or repeatable project command fails.

Do not stop at the first error message.

1. Reproduce the failure with the narrowest deterministic command.
2. Capture the actual failing output and identify the first causal error, not downstream noise.
3. Inspect nearby code, recent Git changes, configuration, lockfiles, and relevant tests.
4. Form one concrete root-cause hypothesis at a time.
5. For independent investigation, delegate read-only scouts to helper models in parallel.
6. For a narrow repair, delegate one isolated writer when useful; the lead remains responsible for review.
7. Make the smallest safe change that addresses the root cause.
8. Add or strengthen a regression test when the defect can recur.
9. Re-run the narrow reproduction, then the required project gates.
10. If the worker repair fails review, reject it and issue a narrower repair task.
11. Update Hafez evidence/state and return to `hafez-autopilot`.

Never:
- disable or weaken a required test merely to make CI green;
- convert skipped/unavailable checks into success;
- hide an error with a broad catch or ignore rule without proving that behavior is intended;
- ask the user to choose an implementation detail that repository evidence can resolve safely.

Escalate only for a genuine product/architecture choice, missing credentials or external authority, destructive action, or a failure that cannot be reproduced with available evidence.
