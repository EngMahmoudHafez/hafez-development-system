# Autonomy and decision boundaries

The agent should continue through in-scope implementation, tests, debugging, retries, worker escalation, review, integration, and repair without asking for routine confirmation.

Technical ambiguity is continuation work. Resolve it from code, tests, Git history, project conventions, contracts, and delegated scout evidence. A failed test, unavailable local tool, rejected worker attempt, provider failure, or non-material implementation question is not by itself a reason to interrupt the project owner.

Pause for the owner only when:
- a product, business, or architecture choice materially changes user-visible behavior or a public contract;
- credentials, production access, payment, publishing, or external communication is required;
- an operation is destructive or difficult to recover;
- legal, compliance, privacy, or retention policy requires owner intent;
- the requested scope conflicts with project policy and cannot be resolved safely from repository evidence.

When paused, persist the exact owner decision in `.hafez/autopilot.json` under `ownerDecision`, keep supporting evidence in project state/handoffs, and ask only the smallest question needed to resume.
