# End-to-end acceptance runbook

This runbook is intentionally project-neutral. Replace every placeholder with repositories you have
explicitly chosen for the test. A path or project name shown in documentation is never authorization
to inspect or modify it.

## 1. Validate Hafez

```bash
cd /absolute/path/to/hafez-development-system
npm ci
npm run validate
npm run test:package
node bin/hafez.mjs doctor . --json
```

## 2. Select safe fixtures

Prefer disposable repositories created specifically for acceptance testing. If you choose an existing
repository, confirm its working tree is clean and create an isolated worktree yourself. Record:

```bash
export HAFEZ_BIN=/absolute/path/to/hafez-development-system/bin/hafez.mjs
export FIXTURE_REPO=/absolute/path/to/explicitly-selected-fixture
```

Do not reuse these variable names for system paths or credentials.

## 3. Inspect before writing

```bash
node "$HAFEZ_BIN" inspect "$FIXTURE_REPO" --json
node "$HAFEZ_BIN" init "$FIXTURE_REPO" --json
```

Confirm the detected stack, Git state, suggested gates, and allowed adoption writes. Then adopt only
the fixture you selected:

```bash
node "$HAFEZ_BIN" init "$FIXTURE_REPO" --apply --json
node "$HAFEZ_BIN" validate "$FIXTURE_REPO" --json
```

## 4. Exercise the lifecycle

```bash
node "$HAFEZ_BIN" plan S-01 "Acceptance fixture capability" --path "$FIXTURE_REPO" --json
node "$HAFEZ_BIN" run "$FIXTURE_REPO" --max-steps 8 --json
node "$HAFEZ_BIN" verify "$FIXTURE_REPO" --json
node "$HAFEZ_BIN" verify "$FIXTURE_REPO" --execute --json
node "$HAFEZ_BIN" handoff "$FIXTURE_REPO" --json
node "$HAFEZ_BIN" resume "$FIXTURE_REPO" --json
```

The run passes when a fresh session can recover the same active slice, source revision, gate evidence,
blockers, and next safe action without chat history.

## 5. Exercise a workspace when needed

Use this only when the chosen fixture genuinely contains multiple repositories:

```bash
export FIXTURE_WORKSPACE=/absolute/path/to/explicitly-selected-workspace

node "$HAFEZ_BIN" workspace "$FIXTURE_WORKSPACE" --init \
  --repository first=repositories/first \
  --repository second=repositories/second --json
```

Review the member list, apply it, then add contract edges only from observed evidence or an explicit
decision. Verify that missing members and artifacts are reported without changing member repositories.

## 6. Exercise isolated delegation

Commit the adopted fixture so its integration checkout is clean. Prepare one writer with a narrow
scope; do not use a paid provider for automated CI acceptance:

```bash
node "$HAFEZ_BIN" delegate codex \
  --path "$FIXTURE_REPO" \
  --role implementer \
  --task "Change only the selected fixture documentation and return structured evidence." \
  --access write-worktree \
  --allowed-path docs \
  --allowed-command "npm test" --json
```

The acceptance suite may simulate the result locally. It must prove one-writer reservation, base SHA,
path scope, clean commits, exact result matching, and passing verification before readiness.

## 7. Test decision boundaries

Record one unresolved product question and verify `hafez run` pauses. Also test one failed or
unavailable gate and one next action requiring publishing or production authority. Hafez must not
invent the decision, convert the gate to success, or perform the external action.

## 8. Clean up

Remove only the disposable worktrees and fixtures created for this run. Never use a broad recursive
delete target or infer cleanup targets from a repository name.
