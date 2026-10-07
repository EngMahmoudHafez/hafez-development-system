---
name: hafez-review
description: Review delegated AI work as the lead model before integration, checking scope, Git evidence, acceptance criteria, security, tests, and architectural fit, then explicitly approve or reject the exact delegated revision.
---

# Hafez Review

You are the lead reviewer, not the worker.

For a completed write delegation:

1. Inspect `hafez delegation-status <task-id>` and the task packet.
2. Read the exact diff and changed files from the managed worktree.
3. Compare the implementation with the active slice acceptance criteria and project conventions.
4. Look specifically for hidden scope expansion, weakened tests, placeholder behavior, secrets, unsafe auth/permission changes, N+1/query regressions, broken contracts, and architectural drift.
5. Run or independently confirm the relevant verification commands. A worker's self-reported passing result is evidence, not proof.
6. Reject the result if any required behavior is missing, any changed file exceeds scope, the review revision is stale, or quality gates are weakened.
7. Record the verdict:
   - approve: `hafez delegation-review <task-id> --verdict approved --summary "<why it is safe>"`
   - reject: `hafez delegation-review <task-id> --verdict rejected --summary "<what must be fixed>"`
8. Only after approval may `hafez delegation-integrate <task-id>` run.

When rejecting, prefer a narrow repair delegation over rewriting the whole task yourself unless the worker repeatedly fails.
