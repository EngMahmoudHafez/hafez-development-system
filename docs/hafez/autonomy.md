# Autonomy and decision boundaries

The agent should continue through in-scope implementation, tests, and repairs without asking for routine confirmation.

Pause for the user only when a product or architecture choice materially changes behavior; credentials, production access, payment, publishing, or external communication is required; an operation is destructive or difficult to recover; or the requested scope conflicts with project policy and cannot be resolved safely.

When paused, save current evidence and the exact decision needed in `.hafez/state.json` and create a handoff.
