# Architecture

## Boundaries

```text
Skills                 Human/model workflow guidance
CLI core               State, inspection, evidence, plans, handoffs
Runner                 Bounded continuation and explicit decision boundaries
Workspace graph        Explicit repositories, contracts, and compatibility gates
Stack adapters         Laravel, Nuxt/Vue, and future ecosystems
Provider adapters      Task translation and safe process invocation
Host adapters          Editors and ACP surfaces such as Zed
Optional integrations  Methodology packs such as Superpowers
```

The core has no provider SDK dependency and stores only repository-owned metadata. Provider authentication and billing remain outside HDS.

## Evidence and state

`.hafez/project.json` stores reviewed project policy. `.hafez/state.json` stores the resumable workflow checkpoint. `.hafez/capabilities.json` tracks deliverables per capability. `.hafez/evidence/` contains current gate results. `docs/hafez/` holds human-readable decisions, slices, runbooks, and handoffs.

Delegation packets live under ignored `.hafez/delegations/` because task text and absolute local paths may be private. Durable conclusions belong in reviewed handoffs, not raw provider packets.

Saved state is a snapshot, not the ultimate truth. Resume reconciles it with current Git and repository evidence.
`lastKnownGoodRevision` tracks the latest verified source revision while excluding `.hafez/` and
`docs/hafez/` metadata-only checkpoints. This keeps a committed verification record or handoff from
making the source appear stale immediately after it is saved.

## Safety model

- Inspection and resume are read-only.
- Adoption writes only HDS state and documentation.
- Verification runs argument-array commands explicitly stored in project policy.
- Reviewers use read-only sandboxes or external read-only mounts.
- Writers require isolated worktrees and non-overlapping scopes.
- Writer results must match the base revision, changed paths, commands, commits, and verification evidence.
- One integrator owns serialized files and final verification.
- Returned model text is untrusted data and never becomes a shell command.
