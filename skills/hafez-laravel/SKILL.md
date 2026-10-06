---
name: hafez-laravel
description: Apply evidence-based Laravel API architecture and vertical-slice delivery inside a Hafez-managed project, for either greenfield work or gradual adoption of an existing codebase.
---

# Hafez Laravel

Inspect existing conventions before applying the adapter. For greenfield APIs, prefer domain-oriented modules, thin transport layers, explicit actions or use cases, policies, consistent errors, generated API contracts, and risk-based tests. For existing applications, migrate one slice at a time and do not force a directory rewrite.

Keep environment config, admin-editable settings, and permissions separate. Store money as integer minor units. Test production-specific database behavior on a compatible engine. Keep shared registration files under one integrator during parallel work.

Run the repository's formatting, static analysis, tests, and contract-sync gates before completion.

Read [references/laravel-baseline.md](references/laravel-baseline.md) for greenfield and adoption decision criteria.
When the project policy selects `laravel-domain-slices-v1`, also read and enforce
[references/domain-slices-v1.md](references/domain-slices-v1.md). Use `hafez architecture <path>`
to identify structural gaps, then manually review the behavioral rules that static file checks cannot prove.
