---
name: hafez-database
description: Review and evolve relational database schemas, migrations, indexes, queries, data integrity, and high-volume data changes safely. Use for Laravel/MySQL/PostgreSQL database work, migration planning, query performance, pagination correctness, and production-safe schema evolution.
---

# Hafez Database

Treat the database as durable product state, not an implementation detail.

Use this workflow for schema changes, migrations, indexes, query performance, cleanup jobs, pagination, data backfills, and integrity problems.

1. Establish facts first: engine/version, schema, table sizes, indexes, foreign keys, nullable/default rules, data volume, write rate, and the exact query or migration involved.
2. Prefer additive and reversible changes. Separate schema rollout, application compatibility, backfill, validation, and cleanup when a one-step migration would be risky.
3. Never assume a migration is safe because it works on an empty test database. Consider lock duration, table rewrite behavior, long transactions, replication, disk growth, and rollback.
4. Require explicit constraints for business invariants where practical: unique keys, foreign keys, check constraints, and appropriate nullability.
5. For slow queries, inspect the real query shape and execution plan before adding indexes. Avoid duplicate or low-value indexes.
6. For changing lists, prefer cursor/keyset pagination when offset pagination can duplicate or skip records.
7. For large deletes/updates/backfills, use bounded batches, stable ordering, resumability, and observable progress. Avoid one giant transaction.
8. Keep money in integer minor units unless the project has a documented alternative.
9. Test both forward behavior and rollback/compatibility boundaries. Add regression coverage for data bugs.
10. Record evidence: migration commands, query plans or representative timings, affected tables, gate results, and known rollout risks.

Autopilot may implement and verify reversible local schema/query fixes. Pause for the project owner before destructive production data loss, irreversible migrations, retention-policy choices, or actions that require production credentials/maintenance windows.

When Laravel is detected, coordinate with `hafez-laravel`; architecture conventions do not override observed schema reality.
