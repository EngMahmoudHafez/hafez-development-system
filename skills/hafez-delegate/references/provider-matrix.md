# Provider matrix

| Adapter | Type | Headless worker | Read-only boundary | Notes |
|---|---|---:|---|---|
| Codex/OpenAI | agent CLI | yes | `codex exec --sandbox read-only` | Supports structured output and managed worktrees. |
| Claude Code | agent CLI | yes | restricted mode plus read-only tools | Use isolated worktrees for writers. |
| Kimi Code | agent CLI/ACP | yes | external read-only mount required | Prompt mode is not a hard read-only boundary. |
| Gemini CLI | agent CLI | optional | plan approval mode plus sandbox | Detect before use. |
| Antigravity desktop | interactive host | no | not applicable | Do not confuse the desktop launcher with `agy`. |
| Antigravity CLI (`agy`) | agent CLI | yes | external isolation for reviews | Optional and separately detected. |
| Zed | editor/ACP host | no | not applicable | Opens projects, packets, and diffs; provider billing stays external. |

Discovery checks command availability and version only. Authentication stays owned by each provider. Do not read credential files or environment values. Subscriptions and API billing remain separate; routing moves new bounded work, not identities or sessions.
