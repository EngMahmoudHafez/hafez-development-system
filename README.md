# Hafez Development System

> A skills-first project operating system for AI-assisted software delivery.

[العربية](README.ar.md) · [Pilot guide](docs/trial-runbook.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

Hafez helps an AI agent understand where a project really is, choose the right workflow, continue
unfinished work, deliver vertical slices, verify evidence, and leave a durable handoff. It works for
new projects and partially built repositories without depending on chat history.

The primary experience is natural language through an installable plugin and its skills. The CLI is
the deterministic engine underneath—not something every user has to memorize.

## Use it like a project co-pilot

Install the plugin, open a repository, and ask normally:

```text
Use Hafez to understand this project and continue to the next verified milestone.
```

Other useful requests:

```text
Continue the feature we stopped working on.
Build account onboarding end-to-end and stop only if you need a product decision.
Check whether this Laravel backend follows our architecture.
Verify the current slice and prepare a handoff for another model.
```

`hafez` routes the request to focused skills automatically. Users can still invoke a
specific skill such as `$hafez-resume` or `$hafez-laravel` when they want direct control.

## What Hafez adds

| Problem | Hafez behavior |
|---|---|
| An unfamiliar or half-built repository | Inspects code, Git, tests, CI, contracts, and documentation before recommending work |
| Context lost between chats or models | Stores compact, reviewable state and handoffs inside the repository |
| Features split across backend and frontend | Plans one capability as matching vertical slices with shared acceptance criteria |
| Agents stopping after the first patch | Continues through local verification and repairs until completion or a genuine decision boundary |
| Architecture drifting over time | Applies stack profiles such as `laravel-domain-slices-v1` and verifies structural requirements |
| Multiple AI subscriptions | Creates bounded provider task packets without sharing credentials or pretending editors are model providers |
| “Tests passed” without proof | Records commands, exit codes, duration, and required-gate status as durable evidence |

## How it works

```text
Natural request
      │
      ▼
hafez
      │
      ├─ unmanaged project ──► inspect ─► adopt
      ├─ existing state ─────► resume
      ├─ feature request ────► plan slice ─► stack skill
      ├─ independent work ───► delegate ─► integrate
      └─ completion claim ───► verify ─► handoff
```

The repository becomes the durable source of truth:

```text
.hafez/
├── project.json       architecture, gates, and autonomy policy
├── state.json         current focus, active slice, blockers, and next action
├── capabilities.json  status per user capability
└── evidence/          verification results

docs/hafez/
├── architecture.md
├── autonomy.md
├── decisions/
├── slices/
└── handoffs/
```

## Install

### Skills-only — recommended for most users

Browse the package before installing:

```bash
npx skills add EngMahmoudHafez/hafez-development-system --list --full-depth
```

Install all Hafez skills into the current project:

```bash
npx skills add EngMahmoudHafez/hafez-development-system
```

Install globally for every project, or choose one agent and skill:

```bash
npx skills add EngMahmoudHafez/hafez-development-system --global
npx skills add EngMahmoudHafez/hafez-development-system --skill hafez --agent codex
npx skills add EngMahmoudHafez/hafez-development-system --skill hafez-laravel --agent claude-code
```

The Skills CLI supports Codex, Claude Code, Cursor, OpenCode, and other compatible agents. A
skills-only installation does not require the Hafez executable; every workflow includes a direct-tool
fallback.

Update or remove installed skills with:

```bash
npx skills update
npx skills update --global
npx skills remove hafez
```

### Full runtime — skills plus deterministic state commands

Add the runtime globally from GitHub:

```bash
npm install --global github:EngMahmoudHafez/hafez-development-system
hafez doctor .
```

Or keep it inside one project:

```bash
npm install --save-dev github:EngMahmoudHafez/hafez-development-system
npx hafez inspect . --json
```

### Full plugin — Codex and ChatGPT Work

The root `plugin.json` packages all skills and the resumable-state hook. During local development,
clone the repository, run `npm install && npm run validate`, then ask the built-in `$plugin-creator`
to add that existing folder to your personal marketplace. Refresh the desktop app and test the plugin
in a new chat. Hooks require the host's normal trust review.

The GitHub and Skills CLI commands above become available after this repository is published at the
declared URL. Until then, test the same flow from a local clone with `npx skills add /absolute/path`
and `npm install --global /absolute/path`.

## The skill pack

| Skill | Activated for |
|---|---|
| `hafez` | End-to-end work or when the correct phase is unclear |
| `hafez-inspect` | Read-only understanding of an unfamiliar repository |
| `hafez-adopt` | Adding durable Hafez state without changing application code |
| `hafez-resume` | Continuing from Git, evidence, blockers, and the latest handoff |
| `hafez-plan-slice` | Planning one end-user capability across repositories |
| `hafez-laravel` | Laravel domain modules, Actions, Policies, thin HTTP layers, and API gates |
| `hafez-nuxt-vue` | Nuxt/Vue contracts, composables, mock-to-real wiring, RTL, and UI gates |
| `hafez-delegate` | Bounded work for Codex, Claude, Kimi, Gemini, Antigravity, or Zed workflows |
| `hafez-verify` | Required quality gates and durable evidence |
| `hafez-handoff` | Safe stopping, ownership changes, blockers, and release checkpoints |

Skills use progressive disclosure: the model first sees a short description, loads the selected
workflow only when relevant, and reads detailed references only when that mode needs them.

### Trust model

The skills-only package contains Markdown instructions, references, and lightweight YAML metadata;
it has no skill-bundled executable scripts, credentials, or MCP dependency. The optional full runtime
adds an inspectable, dependency-free Node.js CLI and lifecycle hook. Review skills before enabling
them because installed skills run with the permissions of the host agent.

## Laravel architecture profile

`laravel-domain-slices-v1` codifies the architecture used by the reference education platform:

- `app/Domain/<Module>` owns business behavior;
- Controllers coordinate `FormRequest → Action → Resource`;
- Policies are explicit and module registration stays inside module providers;
- config, administrator settings, and permission registries stay separate;
- translated fields and integer-minor-unit money follow shared primitives;
- Pint, Larastan, Pest, OpenAPI generation, and OpenAPI zero-diff are required gates.

Run a read-only structural audit with:

```bash
hafez architecture /path/to/laravel-project --json
```

The automated audit never pretends folder checks prove behavior; the skill also requires manual
review of controller, Action, Policy, query, and test boundaries.

## Autonomy and decision boundaries

Adopted projects default to `continue-until-decision`. An agent may inspect, implement reversible
in-scope changes, run local gates, repair failures caused by its task, and update evidence without
asking for routine confirmation.

It pauses for a material product or architecture choice, credentials or production access, external
publishing/payment/communication, destructive work, or a conflict it cannot resolve safely. If a run
ends because of a model limit or environment interruption, `hafez resume` reconstructs the next safe
action from repository state.

## Providers and delegation

Hafez routes capabilities, not accounts. Authentication, billing, and usage limits stay with each
provider. Read-only Codex and Claude adapters are available; Kimi and Antigravity writers require hard
external isolation; Zed and Antigravity Desktop are treated as hosts rather than extra model quotas.

Write-capable multi-provider automation remains intentionally limited until managed worktrees, path
reservations, and an integration queue ship. See [provider rules](docs/providers.md) and the
[roadmap](docs/roadmap.md).

## Superpowers compatibility

[obra/superpowers](https://github.com/obra/superpowers) is an optional, pinned methodology pack.
Superpowers may own brainstorming, TDD, debugging, and branch-finishing workflows. Hafez owns project
inspection, durable state, cross-repository capabilities, provider routing, verification evidence, and
handoffs. See [the integration guide](docs/integrations/superpowers.md).

## Try the full lifecycle

The [end-to-end pilot runbook](docs/trial-runbook.md) uses isolated worktrees for the reference Laravel
backend and Nuxt frontend, adopts both repositories, delivers one shared slice, verifies every gate,
tests a real decision boundary, and proves that a fresh session can resume without chat history.

## Project status

Version `0.1.2` is an evidence-backed preview. It includes the portable Agent Plugin manifest, Codex
compatibility manifest, ten skills, lifecycle hooks, the dependency-free Node.js CLI, tests, schemas,
and open-source governance files.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [GOVERNANCE.md](GOVERNANCE.md),
and [SUPPORT.md](SUPPORT.md). Hafez is released under the [MIT License](LICENSE).

## Development

```bash
npm run validate
```

Maintainers with the built-in `plugin-creator` skill should also run its validator before publishing.
