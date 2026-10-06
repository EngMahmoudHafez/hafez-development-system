# Laravel baseline

## Greenfield

Prefer a modular monolith and vertical slices until evidence justifies distributed services. Keep HTTP controllers thin, business use cases independently testable, authorization explicit, exceptions consistent, and API contracts generated from real routes and schemas.

Document config versus admin settings, translations, money representation, queue priorities, error envelopes, and deployment assumptions before feature expansion.

## Adoption

Do not move an existing application into domain folders in one pass. First infer current conventions, identify hotspots and boundaries, then migrate one end-user slice with tests and measurable gates. Add architecture dependency tests before claiming bounded modules.

Avoid hidden model lifecycle business logic, broad services, raw authorization branches, resource-triggered N+1 queries, `env()` outside config, hand-edited generated contracts, and production mocks.
