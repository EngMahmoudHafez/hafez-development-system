---
name: hafez-api-contract
description: Design, review, evolve, and verify API contracts across backend and frontend consumers, including OpenAPI, versioning, errors, pagination, idempotency, compatibility, generated clients, and contract drift.
---

# Hafez API Contract

Treat the API contract as a shared product boundary.

Use this skill when adding or changing endpoints, OpenAPI schemas, generated clients, mobile/web integrations, pagination, webhooks, or cross-repository producer/consumer contracts.

1. Identify producer, consumers, current contract source, authentication, versioning strategy, and compatibility requirements.
2. Specify request, response, validation errors, authorization failures, pagination metadata/cursors, nullability, enums, dates/timezones, money units, and file semantics explicitly.
3. Keep transport controllers thin and business rules outside the contract layer.
4. Prefer additive compatible evolution. A breaking public contract, versioning policy, or backward-compatibility decision is a project-owner boundary.
5. Make idempotency explicit for retryable writes, payments, webhooks, imports, and externally retried operations.
6. Generate or update OpenAPI from the chosen source of truth; do not maintain two conflicting contracts manually.
7. Verify producer output and consumer expectations. Generated clients must be regenerated from the same revision and checked for drift.
8. Add contract tests for status codes, error shape, validation, authorization, pagination, and representative success payloads.
9. Never treat a mocked frontend response as proof of backend compatibility.
10. For multi-repository products, connect the contract through `hafez-workspace` producer/consumer artifacts and compatibility gates.

Autopilot may repair technical contract drift that preserves documented behavior. Pause for the owner when a public or user-visible breaking change, authentication strategy, or externally committed contract must change.
