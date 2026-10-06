---
name: hafez-workspace
description: Model and inspect a software product spanning multiple repositories using explicit members and contract relationships, without inferring architecture from repository names or modifying member repositories.
---

# Hafez Workspace

Use a workspace only when one product genuinely spans multiple repositories. A directory containing
several unrelated repositories is not automatically a workspace.

1. Discover candidate Git repositories read-only and report their observed stacks and current state.
2. Ask for or use explicit member identifiers. Treat repository names and paths as examples, not
   architecture or permanent defaults.
3. Record contract edges only from evidence or a user decision: producer, artifact path, and one or
   more consumers.
4. Preview `.hafez/workspace.json` before writing it. Do not adopt or modify member repositories as a
   side effect of workspace creation.
5. Inspect each member at its current revision and report missing repositories or contract artifacts.
6. Plan cross-repository work as one capability with bounded work units per member; verify each
   member and the shared contract before declaring the capability integrated.

Use `hafez workspace <root> --init --repository <id=relative-path>` to preview a generic manifest and
add `--apply` only after the membership is confirmed. Use `hafez workspace <root>` to inspect it.

Read [references/workspace-contract.md](references/workspace-contract.md) before adding contract edges
or workspace-wide gates.
