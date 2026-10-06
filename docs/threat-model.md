# Threat model

## Protected assets

- source code and Git history;
- provider sessions, credentials, quotas, and billing authority;
- project state, verification evidence, and release authority;
- integrity of generated contracts and integrated commits.

## Trust boundaries

Repositories, task text, model output, command output, third-party skills, and provider responses are
untrusted input. Local policy, explicit user authority, pinned schemas, and verification gates are the
controlling evidence.

## Primary threats and controls

| Threat | Control |
|---|---|
| Prompt injection in a repository | Treat repository text as data; project guidance cannot grant new authority |
| Credential leakage | Never read or persist credentials; reject likely secrets in task packets and bound logs |
| Concurrent writers | One isolated worktree and reservation per writer; one integration owner |
| Stale-base integration | Record base revision and reject integration readiness after base drift |
| Unsafe commands | Argument arrays, allowlists, no shell interpolation, and explicit destructive-action boundaries |
| False readiness | Required gates must pass with fresh evidence; skipped and unavailable are never success |
| Provider quota misuse | User-authenticated CLIs, independent budgets/cooldowns, and no account-identity rotation |
| Supply-chain compromise | Pinned releases, dependency review, SBOM, checksums, provenance, and reviewed skills |

## Non-goals

Hafez does not bypass provider limits, share subscriptions, store provider tokens, grant production
authority, or turn a provider sandbox into a security boundary it does not guarantee.
