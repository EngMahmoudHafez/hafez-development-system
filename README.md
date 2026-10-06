# Hafez Development System

Hafez Development System (HDS) is a provider-neutral operating layer for software projects. It helps an agent or team start a project, adopt an existing codebase, recover work without chat history, deliver vertical slices, verify evidence, and hand work to another human or model.

It does not replace your framework, coding agent, or engineering judgement. It connects them through durable state and explicit contracts.

## What works in 0.1.0

- Read-only repository inspection and stage recommendation.
- Idempotent adoption without production-code changes.
- Resumable state, capability records, vertical slice plans, verification evidence, and handoffs.
- Ten reusable skills packaged as a portable plugin.
- Provider discovery and structured task packets.
- Read-only execution adapters for Codex and Claude Code.
- Optional Gemini execution when its CLI is installed.
- Safe manual handoff for Kimi and Antigravity when hard external isolation is unavailable.
- Zed integration as an editor/ACP host, not a model provider.
- Optional, version-pinned compatibility with Superpowers.
- Laravel and Nuxt/Vue delivery adapters.

Write-capable multi-provider delegation is intentionally not automated in this release. It requires managed worktrees, path ownership, and an integration queue; see [the roadmap](docs/roadmap.md).

## Why it exists

Agent conversations are not a reliable project database. A new agent should be able to answer these questions from the repository alone:

- What has actually been built?
- Which parts are mocked, integrated, verified, or degraded?
- What changed since the last checkpoint?
- Which decisions and contracts govern the next task?
- Which quality gates passed, failed, or were unavailable?
- What is the next safe action?

HDS stores that operating record in `.hafez/` and `docs/hafez/`.

## Quick start

Requires Node.js 20 or newer. No runtime packages are installed.

```bash
git clone https://github.com/EngMahmoudHafez/hafez-development-system.git
cd hafez-development-system
npm link

cd /path/to/project
hafez inspect .
hafez adopt .
hafez adopt . --apply
hafez resume .
hafez plan S-01 "First user capability"
hafez skills .
```

Run project-defined gates and create a durable handoff:

```bash
hafez verify .
hafez verify . --execute
hafez handoff .
```

Prepare a read-only review for another provider:

```bash
hafez delegate codex --role reviewer --task "Review the active slice" --execute
hafez delegate claude --role reviewer --task "Find missing tests" --execute
hafez delegate kimi --role reviewer --task "Review the API contract"
```

Kimi task packets are generated but not executed by HDS until an external read-only mount or isolated worktree is supplied.

## Lifecycle

```text
Inspect → Adopt → Resume → Plan Slice
   → Implement/Delegate → Integrate → Verify → Handoff
```

Project focus is inferred from evidence and may be `discovery`, `foundation`, `delivery`, `integration`, `hardening`, `release`, or `operation`. Capabilities are tracked separately instead of being collapsed into one misleading percentage.

## Plugin and skills

The repository is both a portable Agent Plugin and a Codex-compatible plugin. Its skills are under [`skills/`](skills/):

- `hafez-orchestrate`
- `hafez-inspect`
- `hafez-adopt`
- `hafez-resume`
- `hafez-plan-slice`
- `hafez-delegate`
- `hafez-verify`
- `hafez-handoff`
- `hafez-laravel`
- `hafez-nuxt-vue`

The SessionStart hook adds only a compact state summary when the current repository has `.hafez/state.json`. Plugin hooks still require the host's normal trust review.

## Provider model

HDS routes capabilities, not identities. Each user authenticates directly with each provider. The repository stores no credentials, tokens, or subscription data.

See [provider support and isolation rules](docs/providers.md).

## Superpowers

[obra/superpowers](https://github.com/obra/superpowers) is an optional execution-methodology integration. HDS does not vendor it. Superpowers can own brainstorming, TDD, debugging, review, and branch-finishing workflows; HDS owns durable state, project recovery, cross-repository contracts, and provider routing.

See [the integration guide](docs/integrations/superpowers.md).

## Development

```bash
npm run validate
```

The project follows MIT licensing, DCO sign-off, and evidence-first contributions. Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [GOVERNANCE.md](GOVERNANCE.md).
