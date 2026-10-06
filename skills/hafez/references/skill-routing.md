# Hafez skill routing

Use the narrowest applicable workflow and keep these responsibilities separate:

1. Explicit user instructions and repository `AGENTS.md` define scope and local conventions.
2. Hafez lifecycle skills own inspection, state, recovery, delegation contracts, verification evidence, and handoffs.
3. Project-local skills own repository-specific commands and conventions.
4. Hafez stack adapters provide Laravel and Nuxt/Vue defaults only when they fit observed evidence.
5. Review guards such as clean-code, tests, docs, security, or accessibility run after or alongside the implementation they cover.
6. Superpowers may provide brainstorming, TDD, debugging, and branch workflows without becoming the project-state owner.

Do not install, invoke, or trust every discovered skill automatically. Prefer project-local skills over similarly named user skills, review the selected skill's instructions, and resolve conflicting ownership before action.
