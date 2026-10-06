# Skill discovery and composition

HDS can be installed as a portable Skills CLI package without the plugin or Node.js runtime:

```bash
# current project
npx skills add EngMahmoudHafez/hafez-development-system

# user-level installation
npx skills add EngMahmoudHafez/hafez-development-system --global

# one entry skill for one host
npx skills add EngMahmoudHafez/hafez-development-system --skill hafez --agent codex
```

Skills-only mode uses the host agent's existing filesystem, Git, and command tools. Full-runtime mode
adds the deterministic `hafez` executable, JSON schemas, automatic state hooks, and provider adapters.

`hafez-get-started` provides a read-only onboarding path. `hafez-workspace` coordinates an explicitly
selected multi-repository product without assigning meaning to repository names. The primary `hafez`
skill routes to both when the request requires them.

Run `hafez skills . --json` to inventory reusable workflows visible in the current environment. The command reads skill metadata only; it does not execute or install skills.

HDS intentionally works with existing skills such as Laravel architecture, Nuxt/Vue delivery, clean-code review, test review, documentation review, Spec Kit, and Superpowers. It does not copy them into project state or assume they are trusted.

Routing precedence:

1. explicit user request;
2. repository guidance and project-local skills;
3. HDS lifecycle and stack skills;
4. user-level specialist skills;
5. optional external methodology packs.

When two skills both claim planning, delegation, or branch ownership, choose one owner for that work unit. In particular, do not run two autonomous subagent schedulers over the same slice.
