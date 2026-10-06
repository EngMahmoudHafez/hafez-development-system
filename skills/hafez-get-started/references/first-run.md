# First run modes

Choose the least invasive mode that satisfies the request.

## Skills-only

Use when the host already discovers skills and the user wants guided workflows without a local
executable. Install into one project or globally with the host's supported skills installer.

## Full runtime

Use when the project needs deterministic `inspect`, `adopt`, `resume`, `run`, `verify`, `delegate`,
`workspace`, `validate`, `migrate`, and `handoff` commands. The runtime is dependency-free and stores
project state only under `.hafez/` and `docs/hafez/` after explicit adoption.

## Full plugin

Use in Codex or ChatGPT Work when the user wants the packaged skills, onboarding, assets, and session
context hook as one installable unit. Plugin installation does not itself adopt a repository.

## Workspace onboarding

A workspace is an explicit graph, not a directory-name convention. Discover Git repositories below
the selected root, show the candidates, and create `.hafez/workspace.json` only after the user confirms
the members and contract relationships. Never infer production authority, credentials, or deployment
ownership from a repository name.

## Adoption write boundary

Adoption may create Hafez metadata, operating documentation, and a missing root `AGENTS.md`. It must
not restructure production code, install packages, execute migrations, or rewrite existing guidance.
