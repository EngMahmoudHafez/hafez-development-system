# Adoption contract

Adoption is documentation and state initialization, not a migration.

Allowed writes:

- `.hafez/`
- `docs/hafez/`
- a new root `AGENTS.md` when none exists

Forbidden during adoption:

- package installation;
- migrations or seeders;
- production source edits;
- architecture rewrites;
- formatting the existing codebase;
- credential or `.env` value capture.

For a dirty repository, record changed paths but do not stage, discard, or absorb them. For a polyrepo product, adopt each repository independently, then describe their contract relationships in the coordinating project record.
