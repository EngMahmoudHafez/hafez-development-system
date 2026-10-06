---
name: hafez-delegate
description: Delegate bounded project work across Codex, Claude Code, Kimi Code, Antigravity, Zed, or compatible providers using structured task packets, isolated write scopes, and evidence-based returns.
---

# Hafez Delegate

Generate a task packet with `hafez delegate <provider> --role <role> --task <task>` when the CLI is
available. In a skills-only installation, construct the same packet from
[references/task-packet.md](references/task-packet.md) and hand it to an available agent mechanism.
Execution is read-only by default.

- Delegate only work that can be independently verified.
- Use scouts, reviewers, and researchers read-only.
- Require an isolated worktree for any writer. Never let two delegates share a write scope.
- For a CLI writer, require `--access write-worktree`, at least one `--allowed-path`, and at least one
  exact `--allowed-command`. Inspect `hafez integration-queue` before integration.
- Use one integrator for contracts, root routes, seed registries, lockfiles, and other serialized files.
- Do not copy credentials into packets or state. Provider authentication remains provider-owned.
- A delegate result is evidence, not truth; the integrator verifies it locally.
- Do not automatically execute Kimi or Antigravity CLI packets until hard external isolation is
  actually provided; a managed worktree alone is not a universal sandbox.
- Do not claim that an editor host is a model provider. Zed opens context; Antigravity may require interactive handoff.

Read [references/provider-matrix.md](references/provider-matrix.md) for current adapter behavior and [references/task-packet.md](references/task-packet.md) for the return contract.
