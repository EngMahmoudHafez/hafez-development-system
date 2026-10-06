---
name: hafez-plan-slice
description: Plan a vertical project slice with business rules, acceptance criteria, dependencies, bounded work units, and verification before implementation begins.
---

# Hafez Plan Slice

Use `hafez plan <S-ID> <title>` to create the slice record when the CLI is available. In a skills-only
installation, create `docs/hafez/slices/<S-ID>.md` directly using the same fields in
[references/slice-schema.md](references/slice-schema.md), then complete it before implementation.

- Define an end-user capability, not an infrastructure layer.
- Number business rules and acceptance criteria.
- Declare dependencies, open questions, decisions, repositories, write scopes, and required gates.
- Reuse the same slice id across backend, frontend, contracts, and deployment work.
- Split parallel work into non-overlapping write scopes. Reserve shared or serialized files for one integrator.
- Do not plan speculative abstractions or future variants without a current acceptance criterion.

Read [references/slice-schema.md](references/slice-schema.md) for work-unit and capability status conventions.
