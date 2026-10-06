# Laravel domain slices v1

This profile captures the portable architecture contract used by the Hafez Laravel skill and the
reference education-platform backend. It is a modular monolith delivered through vertical slices.

## Required structure

- Business code lives under `app/Domain/<Module>` with module-owned Actions, Models, Policies,
  Services, events, listeners, jobs, notifications, and a `<Module>ServiceProvider` as needed.
- HTTP code is versioned and area-based under `app/Http/Controllers/Api/V1`, with matching
  FormRequests and Resources. Routes live in `routes/api/<area>.php`.
- `routes/api.php` and `database/seeders/DatabaseSeeder.php` are serialized integration files.
- Shared primitives live under `app/Support`; API errors use one renderer and one envelope.
- Environment-owned config, administrator-editable settings, and the permission registry remain
  separate concerns.
- OpenAPI is generated from the application and is never hand-edited.

## Required behavior

- Controllers coordinate `FormRequest -> Action -> Resource` and contain no business rules.
- One Action represents one business operation and is independently testable.
- Authorization is expressed through explicit Policies.
- Domain registration belongs to the module provider, not `AppServiceProvider`.
- Translated fields use the project's bilingual representation. Money uses integer minor units plus
  currency and never floating-point values.
- Queries load Resource dependencies explicitly and do not hide N+1 access in Resources.
- Every endpoint slice tests success, validation failure, and authorization failure.

## Required gates

Run formatting, Larastan, Pest, OpenAPI generation, and an OpenAPI zero-diff check in that order.
A missing, skipped, or unavailable gate is not success.

`hafez architecture` verifies the structural portion. A reviewer must still inspect the behavioral
rules because folder names alone cannot prove that controllers are thin or that Actions own the rules.
