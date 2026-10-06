# Minimal skills-only state

Create only the fields supported by observed evidence. Do not invent gates, architecture, or product
status.

`.hafez/project.json`:

```json
{
  "schemaVersion": "hds-project/v1",
  "project": { "id": "project-slug", "name": "Project name" },
  "adapters": [],
  "gates": [],
  "policies": {
    "planning": "vertical-slices",
    "requireEvidence": true,
    "writeDelegationRequiresWorktree": true,
    "architectureProfile": null,
    "serializedPaths": [],
    "autonomy": {
      "mode": "continue-until-decision",
      "continueWithoutApproval": [],
      "pauseWhen": []
    }
  }
}
```

Populate the autonomy arrays from the current project policy. Use the standard Hafez defaults only
when no repository policy narrows them.

`.hafez/state.json`:

```json
{
  "schemaVersion": "hds-state/v1",
  "updatedAt": "ISO-8601 timestamp",
  "workflowState": "adopted",
  "currentFocus": "discovery",
  "confidence": 0.5,
  "activeSlice": null,
  "lastKnownGoodRevision": null,
  "nextSafeAction": "Document the current architecture and choose one bounded slice.",
  "blockers": [],
  "openQuestions": [],
  "gates": {},
  "lastHandoff": null
}
```

Also create `.hafez/capabilities.json`, `.hafez/delegation.json`, and the `docs/hafez/` operating
folders only when missing. Preserve existing files byte-for-byte.
