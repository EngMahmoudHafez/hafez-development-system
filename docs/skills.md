# Skill discovery and composition

Run `hafez skills . --json` to inventory reusable workflows visible in the current environment. The command reads skill metadata only; it does not execute or install skills.

HDS intentionally works with existing skills such as Laravel architecture, Nuxt/Vue delivery, clean-code review, test review, documentation review, Spec Kit, and Superpowers. It does not copy them into project state or assume they are trusted.

Routing precedence:

1. explicit user request;
2. repository guidance and project-local skills;
3. HDS lifecycle and stack skills;
4. user-level specialist skills;
5. optional external methodology packs.

When two skills both claim planning, delegation, or branch ownership, choose one owner for that work unit. In particular, do not run two autonomous subagent schedulers over the same slice.
