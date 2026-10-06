# Nuxt and Vue baseline

Choose topology from deployment ownership and release cadence:

- one workspace when applications evolve and release together;
- versioned packages when shared contracts are stable;
- duplicated packages only when deployment independence is worth explicit sync automation.

Use generated API types from a pinned contract. Keep presentation behind domain composables and a repository interface. Mock and real adapters must share the same contract and be selectable per capability, not through one misleading global boolean.

Recommended session states are `unknown`, `guest`, `authenticated`, and `unreachable`. A network or server failure must not redirect a user as though authentication failed.

For bilingual or RTL products, enforce logical direction utilities and translation-key parity. Include accessibility and browser smoke checks according to user risk.
