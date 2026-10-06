# Verification gates

Each gate has an id, argument-array command, required flag, status, duration, exit code, and bounded output. Argument arrays prevent shell expansion and make commands reviewable.

Typical profiles:

- fast: changed-scope lint and focused tests;
- CI: formatting, static analysis, tests, contract sync, and build;
- release: CI plus security, migration, deployment, rollback, and smoke evidence.

Cross-repository contract checks must pin the producer revision. Comparing a frontend branch only with backend `main` can reject compatible paired changes or accept stale assumptions.
