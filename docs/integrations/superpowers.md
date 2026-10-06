# Superpowers integration

HDS is compatible with [obra/superpowers](https://github.com/obra/superpowers) as an optional external methodology pack. The reviewed compatibility baseline is stored in [`integrations/superpowers.lock.json`](../../integrations/superpowers.lock.json).

## Ownership

Superpowers may own:

- brainstorming and design exploration;
- writing implementation plans;
- test-driven development;
- systematic debugging;
- requesting and receiving code review;
- verification-before-completion and branch finishing.

HDS owns:

- inspection, adoption, state, and recovery;
- cross-repository capability and contract tracking;
- provider routing and task packets;
- stack adapters and serialized-file ownership;
- durable evidence and handoffs.

Install Superpowers through its official instructions for each harness. Do not copy its skills into HDS or track its `main` branch as an unpinned runtime dependency. If an offline vendor is ever added, preserve its MIT license and attribution in `THIRD_PARTY_NOTICES.md`.

When HDS central delegation is active, avoid enabling a second autonomous subagent scheduler for the same slice. Individual Superpowers workflows remain useful inside a single bounded work unit.
