# Provider and host support

| Adapter | Local probe | Current HDS behavior | Hard read-only guarantee |
|---|---:|---|---:|
| Codex/OpenAI | `codex` | headless read-only execution | yes, through Codex sandbox |
| Claude Code | `claude` | restricted headless review | yes, with read-only tools |
| Kimi Code | `kimi` | task packet only | external isolation required |
| Gemini CLI | `gemini` | optional plan-mode execution | provider sandbox plus plan policy |
| Antigravity desktop | `antigravity` | task packet/manual handoff | host only |
| Antigravity CLI | `agy` | task packet only | external isolation required |
| Zed | `zed` | opens packet/project/diff | not a model provider |

Provider probes report `installed`, `configured`, and `ready` separately. Codex and Claude configuration uses their official auth-status exit code with output suppressed, but `ready` remains unknown until a real dispatch because an apparently valid local session can still fail to refresh or be rate-limited. Kimi also remains `ready: null` because its safe probe confirms configuration, not live account validity. Probes do not read environment variables, credential files, keychains, or raw provider configuration.

## Routing rules

- Route a new bounded task when a provider is available; do not migrate a hidden session or identity.
- Keep subscription-backed CLI usage distinct from API-key billing.
- Apply provider concurrency, timeout, and budget limits independently.
- Reviewers receive a stable read-only snapshot.
- Implementers return a commit or patch from an isolated worktree.
- The integrator rechecks the base revision and runs local gates.
