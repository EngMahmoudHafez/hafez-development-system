# Hafez Development System

> A skills-first project operating system for AI-assisted software delivery.

[العربية](README.ar.md) · [First run](#first-run) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Security model](docs/threat-model.md)

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
| One product spans several repositories | Uses an explicit repository and contract graph without guessing from project names |
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

Autopilot continuity is durable too. While a continuous run is active, `.hafez/autopilot.json`
records whether Hafez should resume automatically or is waiting at a real project-owner boundary.
Session-start hooks load that state so a model/session interruption does not become an artificial stop.

The repository becomes the durable source of truth:

```text
.hafez/
├── project.json       architecture, gates, and autonomy policy
├── autopilot.json     continuous-loop state and owner-boundary status
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

## First run

Hafez never assumes a repository shown in documentation is the project to operate on. Start in the
directory you actually chose:

```bash
hafez init .             # read-only preview
hafez init . --apply     # create only Hafez state and operating docs
hafez init . --architecture-profile laravel-domain-slices-v1 --apply
                         # explicitly opt in to the strict Laravel baseline
hafez run .              # show one bounded next action
hafez run . --execute    # execute deterministic gates/handoffs
hafez autopilot .        # safe auto-adopt + continuous host-agent loop
hafez delegation-next <task-id>      # decide review/retry/escalate/integrate/owner boundary
hafez delegation-continue <task-id>  # retire failed attempt and create the next retry/escalation packet
```

`hafez run` is bounded and resumable. In plugin/skills mode the host agent performs queued planning
and implementation work and keeps cycling until a recorded decision boundary. The standalone CLI
executes only deterministic operations itself; it never pretends to contain an LLM.

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
| `hafez-get-started` | Safe first-run inspection and choosing an installation mode |
| `hafez-inspect` | Read-only understanding of an unfamiliar repository |
| `hafez-adopt` | Adding durable Hafez state without changing application code |
| `hafez-resume` | Continuing from Git, evidence, blockers, and the latest handoff |
| `hafez-plan-slice` | Planning one end-user capability across repositories |
| `hafez-laravel` | Laravel domain modules, Actions, Policies, thin HTTP layers, and API gates |
| `hafez-nuxt-vue` | Nuxt/Vue contracts, composables, mock-to-real wiring, RTL, and UI gates |
| `hafez-autopilot` | Continuous lead-agent loop: adopt, plan, delegate, repair, review, verify, and continue |
| `hafez-debug` | Evidence-first reproduce → repair → regression-test → reverify loop |
| `hafez-delegate` | Bounded work for Codex, Claude, Kimi, Gemini, Antigravity, or Zed workflows |
| `hafez-review` | Strong-model review and approval of delegated writes before integration |
| `hafez-verify` | Required quality gates and durable evidence |
| `hafez-handoff` | Safe stopping, ownership changes, blockers, and release checkpoints |
| `hafez-workspace` | Explicit multi-repository members, contracts, and integration state |

Skills use progressive disclosure: the model first sees a short description, loads the selected
workflow only when relevant, and reads detailed references only when that mode needs them.

### Trust model

The skills-only package contains Markdown instructions, references, and lightweight YAML metadata;
it has no skill-bundled executable scripts, credentials, or MCP dependency. The optional full runtime
adds an inspectable, dependency-free Node.js CLI and lifecycle hook. Review skills before enabling
them because installed skills run with the permissions of the host agent.

## Laravel architecture profile

`laravel-domain-slices-v1` codifies an opt-in Laravel modular-monolith baseline:

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

The profile is never forced onto an existing Laravel repository during adoption. Legacy projects can
adopt Hafez first and migrate one vertical slice at a time; enable the profile explicitly only after
choosing that architecture policy.

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

Write-capable task packets now create one managed detached worktree, one writer reservation, explicit
path and command scopes, a base revision, and a structured result. A write result is not integratable
until a lead reviewer approves the exact delegated revision; `hafez delegation-integrate <task-id>`
then performs the deterministic cherry-pick only after all readiness checks pass. Failed or rejected workers can be continued with `hafez delegation-continue <task-id>`. Hafez
retires the old attempt without deleting its evidence, carries failure/review context forward, retries
at the current tier, then escalates worker → specialist → lead when retries are exhausted. Technical
failure is not a project-owner decision. Interrupted write tasks remain visible in
`hafez integration-queue` as pending work. If a
writer session is intentionally abandoned, `hafez delegation-abort <task-id>` removes its managed
worktree and releases its reservation so a replacement writer can proceed safely. Hafez still leaves
commit integration to one human or host-agent integrator. Kimi and Antigravity CLI execution stays
packet-only until the caller provides a hard external isolation boundary. See [provider rules](docs/providers.md).

## Multi-repository products

Create a workspace only from explicit members:

```bash
hafez workspace /path/to/product \
  --init \
  --repository service=repositories/service \
  --repository client=repositories/client

# Review, then persist it
hafez workspace /path/to/product --init \
  --repository service=repositories/service \
  --repository client=repositories/client \
  --apply
```

Add producer/consumer contracts to `.hafez/workspace.json`, then inspect the graph with
`hafez workspace /path/to/product`. The identifiers above are deliberately generic examples. See
[workspace contracts](docs/workspaces.md).

Preview or execute workspace compatibility gates with `hafez workspace-verify /path/to/product` and
`hafez workspace-verify /path/to/product --execute`.

## Validation and migration

```bash
hafez validate .
hafez migrate .          # dry-run
hafez migrate . --apply  # known, schema-validated migrations only
```

Migrations never fill missing product facts. An old document that cannot satisfy the current schema
stops with field-level errors for a maintainer decision.

## Superpowers compatibility

[obra/superpowers](https://github.com/obra/superpowers) is an optional, pinned methodology pack.
Superpowers may own brainstorming, TDD, debugging, and branch-finishing workflows. Hafez owns project
inspection, durable state, cross-repository capabilities, provider routing, verification evidence, and
handoffs. See [the integration guide](docs/integrations/superpowers.md).

## Try the full lifecycle

The [end-to-end acceptance runbook](docs/trial-runbook.md) uses only repositories the tester explicitly
selects. It exercises adoption, a slice, gates, a decision boundary, isolated delegation, optional
workspace contracts, and fresh-session recovery without treating any documented path as a target.

## Project status

Version `0.2.0` is an evidence-backed preview. It includes the portable Agent Plugin manifest, Codex
compatibility manifest, twelve skills, onboarding and artwork, lifecycle hooks, the dependency-free
Node.js CLI, schema validation and migrations, bounded autonomous continuation, isolated delegation,
multi-repository workspaces, release automation, tests, and open-source governance files.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [GOVERNANCE.md](GOVERNANCE.md),
and [SUPPORT.md](SUPPORT.md). Hafez is released under the [MIT License](LICENSE).

## Development

```bash
npm run validate
npm run test:package
```

Maintainers with the built-in `plugin-creator` skill should also run its validator before publishing.
