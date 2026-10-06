---
name: hafez-nuxt-vue
description: Build or adopt Nuxt and Vue applications in Hafez vertical slices with generated API contracts, mock-to-real adapters, explicit session states, RTL/i18n support, and frontend quality gates.
---

# Hafez Nuxt Vue

Match the current application before choosing Nuxt, Vue SPA, monorepo, or duplicated packages. Do not impose a topology only because a reference project used it.

Keep pages and components behind domain composables and repository interfaces. Mock and real API implementations must be replaceable adapters; presentation code must not import runtime mock stores directly. Generate client types from a versioned contract and pin cross-repository verification to a specific producer revision.

Represent session state explicitly, including an unreachable backend. Treat RTL, translation parity, accessibility, type checking, tests, and build as first-class gates when applicable.

Read [references/nuxt-vue-baseline.md](references/nuxt-vue-baseline.md) for topology, contract, and mock-migration decisions.
