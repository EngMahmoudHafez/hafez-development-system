# Workspace contract

The manifest uses `hds-workspace/v1` and contains explicit repositories and contracts.

```json
{
  "schemaVersion": "hds-workspace/v1",
  "repositories": [
    { "id": "service", "path": "repositories/service" },
    { "id": "client", "path": "repositories/client" }
  ],
  "contracts": [
    {
      "id": "public-api",
      "producer": { "repository": "service", "path": "openapi.json" },
      "consumers": [
        { "repository": "client", "path": "generated/api-client.ts" }
      ]
    }
  ]
}
```

Identifiers are stable labels chosen for this workspace. Paths are relative, must stay inside their
repository boundary, and do not imply a framework or architectural role. A contract artifact may be
OpenAPI, GraphQL schema, protobuf, events, database migration contract, package interface, or another
explicitly governed artifact.

For a cross-repository slice, record one acceptance criterion for contract generation, one for every
consumer update, and one workspace-level compatibility check. Do not mark integration complete when
any required member gate is failed, skipped, unavailable, or based on a stale revision.
