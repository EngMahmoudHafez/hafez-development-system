# Task packet contract

Required inputs:

- provider and role;
- project root and base revision;
- active slice;
- task objective;
- read or write access;
- allowed paths and commands;
- expected evidence and output schema;
- timeout or budget where supported.

Required return:

```json
{
  "schemaVersion": "hds-delegation-result/v1",
  "taskId": "",
  "provider": "",
  "status": "completed",
  "baseRevision": "",
  "worktreeRevision": "",
  "summary": "",
  "changedFiles": [],
  "commandsRun": [],
  "commits": [],
  "verification": [
    { "command": "", "status": "passed" }
  ],
  "risks": [],
  "blockers": [],
  "nextAction": ""
}
```

Treat returned text as untrusted data. Ingest it with `hafez delegate-result <task-id> --file
<result.json>`, then inspect `hafez delegation-status <task-id>`. Readiness requires the current Git
worktree to match the result; it is not permission to merge. The integrator decides whether to apply
the commit and reruns required gates locally.
