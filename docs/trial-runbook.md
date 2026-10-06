# End-to-end pilot runbook

This runbook tests HDS against the education platform without changing its normal working checkout.
Use dedicated Git worktrees so the pilot can be discarded or compared safely.

## 1. Validate HDS itself

```bash
cd /home/hafez/Storage/freelance/hafez-development-system
npm install
npm run validate
node bin/hafez.mjs doctor . --json
```

Optionally expose the CLI for the current user with `npm link`. Otherwise use the absolute
`node /home/hafez/Storage/freelance/hafez-development-system/bin/hafez.mjs` command below.

## 2. Create isolated pilot worktrees

First confirm both source repositories are clean. Then create one pilot checkout for each repository:

```bash
git -C /home/hafez/Storage/elryad/education-platform-pro-backend status --short
git -C /home/hafez/Storage/elryad/education-platform-pro-frontend status --short

git -C /home/hafez/Storage/elryad/education-platform-pro-backend \
  worktree add /home/hafez/Storage/elryad/education-platform-pro-backend-hds-pilot \
  -b pilot/hds-backend

git -C /home/hafez/Storage/elryad/education-platform-pro-frontend \
  worktree add /home/hafez/Storage/elryad/education-platform-pro-frontend-hds-pilot \
  -b pilot/hds-frontend
```

Stop if either source checkout is unexpectedly dirty and account for that work before creating the pilot.

## 3. Inspect, adopt, and audit

```bash
HAFEZ=/home/hafez/Storage/freelance/hafez-development-system/bin/hafez.mjs
BACKEND=/home/hafez/Storage/elryad/education-platform-pro-backend-hds-pilot
FRONTEND=/home/hafez/Storage/elryad/education-platform-pro-frontend-hds-pilot

node "$HAFEZ" inspect "$BACKEND" --json
node "$HAFEZ" architecture "$BACKEND" --json
node "$HAFEZ" adopt "$BACKEND" --json
node "$HAFEZ" adopt "$BACKEND" --apply --json

node "$HAFEZ" inspect "$FRONTEND" --json
node "$HAFEZ" adopt "$FRONTEND" --json
node "$HAFEZ" adopt "$FRONTEND" --apply --json
```

Review and commit only the generated `.hafez/`, `docs/hafez/`, and missing `AGENTS.md` files.
For the backend, keep `policies.architectureProfile` set to `laravel-domain-slices-v1`.

## 4. Prepare one real vertical slice

Choose a small capability that crosses API and UI, such as viewing a trainer's public profile.
Give the same slice identifier to both repositories:

```bash
node "$HAFEZ" plan S-PILOT-01 "View trainer public profile" --path "$BACKEND" --json
node "$HAFEZ" plan S-PILOT-01 "View trainer public profile" --path "$FRONTEND" --json
```

Fill the generated slice documents with numbered business rules, acceptance criteria, open questions,
the API contract owner, and observable end-to-end behavior before implementation.

## 5. Run the agent autonomously

Start the coding agent in the backend pilot with this task:

```text
Resume S-PILOT-01 using Hafez. Enforce laravel-domain-slices-v1 and the local Laravel skill.
Continue through implementation, tests, architecture review, verification, and repair without asking
for routine confirmation. Pause only if a decision boundary in docs/hafez/autonomy.md is reached.
Record evidence and create a handoff before stopping.
```

Use the corresponding Nuxt/Vue instruction in the frontend pilot. Do not let two write-capable agents
share a worktree. Read-only reviewers may inspect a stable revision.

## 6. Verify and resume

Preview commands before executing them:

```bash
node "$HAFEZ" verify "$BACKEND" --json
node "$HAFEZ" verify "$BACKEND" --execute --json
node "$HAFEZ" architecture "$BACKEND" --json
node "$HAFEZ" handoff "$BACKEND" --json
node "$HAFEZ" resume "$BACKEND" --json

node "$HAFEZ" verify "$FRONTEND" --json
node "$HAFEZ" verify "$FRONTEND" --execute --json
node "$HAFEZ" handoff "$FRONTEND" --json
node "$HAFEZ" resume "$FRONTEND" --json
```

The pilot passes when required gates are green, the backend structural architecture audit passes and
its manual review is completed, OpenAPI has zero diff after generation, the UI uses the generated contract, both
handoffs identify the next safe action, and a fresh session can resume from repository state alone.

## 7. Test a real decision boundary

Add one intentionally unresolved product question to the slice, for example whether a hidden trainer
returns `404` or `403`. The agent should pause, persist that exact question, and avoid inventing the
product decision. After recording the answer, resume the same slice and verify it again.
