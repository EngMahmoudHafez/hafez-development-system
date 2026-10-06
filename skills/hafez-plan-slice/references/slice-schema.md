# Slice schema

A slice contains:

- stable id and user-visible objective;
- numbered business rules and acceptance criteria;
- dependencies and architecture decisions;
- work units with repository, role, access, and bounded write scope;
- required verification gates;
- open questions and intentionally deferred work.

Work units may run in parallel only when their write scopes do not overlap. The integrator owns serialized files and cross-repository contract updates.

Use the same slice id across API, web, admin, mobile, infrastructure, documentation, and commits so future agents can reconstruct the complete capability.
