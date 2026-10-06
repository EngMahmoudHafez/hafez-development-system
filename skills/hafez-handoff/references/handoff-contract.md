# Handoff contract

A handoff is an event and durable artifact, not only a final phase.

Record:

- repository, branch, revision, and dirty state;
- active slice and capability states;
- completed and incomplete work;
- changed files and serialized files touched;
- gate evidence and contract revisions;
- decisions, assumptions, risks, blockers, and open questions;
- one next safe action.

A blocked handoff is valid when it clearly identifies the missing user decision or external state. A release handoff is valid only when every required gate has current passing evidence.
