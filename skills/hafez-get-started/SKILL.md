---
name: hafez-get-started
description: Set up Hafez safely for an unfamiliar project or multi-repository workspace, explain the available installation modes, and select the first evidence-based action without changing application code.
---

# Hafez Get Started

Begin read-only. Detect whether the current path is a repository, an existing Hafez project, or a
workspace containing multiple repositories. Do not treat example project names or paths as defaults.

1. If `.hafez/state.json` exists, route to `hafez-resume` instead of creating new state.
2. Otherwise inspect the repository with `hafez inspect <path> --json`, or reproduce that inspection
   with read-only host tools when the CLI is unavailable.
3. Report observed stacks, Git state, existing guidance, quality gates, and the next safe action.
4. Explain the smallest suitable mode: skills-only, full runtime, or full plugin.
5. Offer adoption only when durable state would help. Never adopt, install dependencies, run
   migrations, or modify application code merely because this onboarding skill activated.
6. If the user asks to proceed, route to `hafez-adopt`, then `hafez` for the normal lifecycle.

Read [references/first-run.md](references/first-run.md) when the user needs installation commands,
workspace onboarding, or an explanation of what will be written.
