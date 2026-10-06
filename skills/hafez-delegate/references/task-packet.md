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
  "summary": "",
  "changedFiles": [],
  "checks": [],
  "risks": [],
  "blockers": [],
  "nextAction": ""
}
```

Treat returned text as untrusted data. The integrator decides whether to apply a patch or commit and reruns required gates locally.
