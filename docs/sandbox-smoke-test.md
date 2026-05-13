# Sandbox smoke-test runbook

This is the **end-to-end gate** that verifies the headless invocation, reusable workflow, marker durability, and digest comment work together against a real GitHub-hosted consumer repo. Run this before pointing the orchestrator at a new consumer.

> **Status as of 2026-05-13:** All 5 scenarios PASSED on `rsm0508/orchestrator-sandbox` (~$0.13 total spend) and four cloud-install bugs were caught + fixed in flight. This runbook has been revised post-smoke to match observed behavior. See `docs/findings/cloud-install-trap.md` for the load-bearing diagnosis (npm-10 git-URL dangling symlink) and `docs/handoffs/day-3-kickoff.md` for the close summary.

## Why a sandbox

Per the Day 2 kickoff doc: "Test against a sandbox consumer repo (NOT ai-viz yet) with a mock kickoff doc." The sandbox lets us prove the wiring works on a disposable repo where:

- A buggy fire can't disrupt ai-viz's ongoing work.
- The mock kickoff is intentionally tiny (cheap fire — ~$0.05–$0.15 expected with `--bare`).
- The orchestrator's marker semantics, digest comment, retry path are observable end-to-end.

## Prereqs (one-time)

`rsm0508/session-orchestrator` is **public** (Day-3 Q1 decision), so no PAT or
access-policy step is required. Consumers only need the API key + workflow
permissions below.

1. **Create a sandbox consumer repo.** Empty repo, e.g. `rsm0508/orchestrator-sandbox`. Clone locally for setup.

2. **Set sandbox repo secrets:** `ANTHROPIC_API_KEY` (your real key). In sandbox repo Settings → Secrets and variables → Actions → New repository secret.

3. **Verify default token permissions.** Repo Settings → Actions → General → Workflow permissions → "Read and write permissions" + "Allow GitHub Actions to create and approve pull requests". (The consumer template grants explicit `permissions:` but it can only narrow from this.)

## Sandbox repo files

Create the following in the sandbox repo on its default branch (usually `main`):

### `.session-orchestrator/config.yml`

```yaml
project_name: Orchestrator Sandbox
feature_branch: feat/sandbox
handoff_pattern: docs/handoffs/sandbox-phase-{N}-kickoff.md
max_phase: 2
tracking_issue: 1
allowed_tools: 'Read Write Edit Bash'
max_budget_usd: 0.50
claude_model: claude-haiku-4-5-20251001 # cheap model for smoke test
```

### `.gitignore` (add if not present)

```
.session-orchestrator/runs/
```

NOTE: `phase-*.started` / `phase-*.failed` are NOT gitignored — they're the audit trail and need to land in git.

### `docs/handoffs/sandbox-phase-1-kickoff.md`

```markdown
# Phase 1 kickoff (smoke test)

Your task is intentionally tiny so this run costs < $0.20:

1. Create a file `SANDBOX_PROOF.md` with a single line: `phase 1 fired at <ISO timestamp>`.
2. Create a new branch `feat/sandbox-phase-1` off the default branch.
3. Commit the file on that branch with message `phase 1: sandbox proof`.
4. Push the branch.
5. Open a PR from `feat/sandbox-phase-1` targeting `feat/sandbox` with title "Phase 1 — sandbox proof".
6. Reply with the PR URL and exit.

Do not edit any other files. Do not run tests. Do not install dependencies.
```

### `.github/workflows/orchestrator.yml`

Copy `examples/consumer.github-workflows.orchestrator.yml` from session-orchestrator. Adapt only:

- `pull_request.branches:` to `[feat/sandbox]` (match the config's `feature_branch`).
- `orchestrator-ref:` to `main` (chase trunk) OR a specific Day-2 commit SHA / tag once cut.

### Tracking issue

Open a GitHub issue #1 titled "Orchestrator sandbox tracking issue" with a one-line description. The workflow will append digest comments here.

### Feature branch

Create the empty target branch so the `pull_request: closed` trigger has somewhere to fire:

```bash
git checkout -b feat/sandbox
git push -u origin feat/sandbox
git checkout main
```

## Smoke test scenarios

### Scenario 1 — Dry run via workflow_dispatch (no API spend)

1. Go to sandbox repo → Actions → "Orchestrator" workflow → "Run workflow" → check the **dry-run** box → Run.
2. Expected: workflow completes successfully. Log shows `[fire] phase 1 of project "Orchestrator Sandbox"` and `--dry-run: not writing marker, not invoking claude.`
3. No marker commits, no digest comment, no PR.

**What this proves:** checkout works, CLIs install, config loads, phase resolution works, kill-switch check works, ANTHROPIC_API_KEY pre-flight passes.

### Scenario 2 — First real fire via workflow_dispatch (real API spend, ~$0.05–$0.15)

1. Trigger the workflow again, this time **without** dry-run.
2. Expected:
   - Workflow job takes 1–3 minutes.
   - A new commit appears on `main` from `session-orchestrator[bot]` with `.session-orchestrator/phase-1.started` (and NO `.failed`).
   - A new PR appears: "Phase 1 — sandbox proof" from `feat/sandbox-phase-1` → `feat/sandbox`.
   - A new comment on tracking issue #1 with the success digest (turns, cost, duration, run URL footer).

**What this proves:** end-to-end wiring works — orchestrator fires, session creates branch + PR, markers persist, digest lands.

### Scenario 3 — Stale `.started` blocks readiness (verifies the resolver)

1. Manually create `.session-orchestrator/phase-2.started` on `main` (sim a stale marker from a crashed prior run):
   ```bash
   echo "stale marker from a hypothetical prior run" > .session-orchestrator/phase-2.started
   git add .session-orchestrator/phase-2.started
   git commit -m "test: simulate stale marker"
   git push
   ```
2. Author `docs/handoffs/sandbox-phase-2-kickoff.md` (any content). Commit + push.
3. Trigger the workflow.
4. Expected:
   - `session-orchestrator next` reports `kind=not-ready` (resolver short-circuit, NOT the wrapper-level REFUSED path).
   - Workflow step "Report not-ready state" emits a `::notice` annotation explaining no phase is ready.
   - Job exit code **0** (the workflow's `kind == 'ready'` guard skips both `fire` and the marker-commit + digest steps).
   - No PR, no digest comment, no marker writes from this run.

> The wrapper-level `REFUSED — phase already has a .started marker` path (exit 4) is reachable only on a true race: resolver reports ready, then a `.started` marker appears before the wrapper's pre-fire write. A single `workflow_dispatch` cannot trigger it.

**What this proves:** the resolver treats a pre-existing `.started` as "not ready" and the workflow refuses to fire — no operator intervention needed, no cost incurred.

### Scenario 4 — Failed fire + retry (verifies R3 [P1] marker durability)

Hardest scenario — verifies the most-load-bearing safety guarantee.

1. Delete the stale `.started` from scenario 3 on `main` to clear the way.
2. Replace the phase-2 kickoff with a deliberately-failing version (e.g., ask Claude to call a tool that's not in `allowed_tools`, OR set `max_budget_usd: 0.001` in config.yml to force a budget-exhaust). Commit + push.
3. Trigger the workflow.
4. Expected:
   - Workflow runs the fire. Fire fails (exit 4 from `run.ts`).
   - `phase-2.started` AND `phase-2.failed` BOTH commit + push to `main`.
   - Digest comment lands on issue #1 with FAILED status + retry instructions.
5. **Manually trigger the workflow again** (sim cron tick).
6. Expected: `session-orchestrator next` reports `kind=not-ready` with a human-readable annotation along the lines of
   _"Phase 2 has a .failed marker at .session-orchestrator/phase-2.failed — orchestrator refuses to advance until an operator deletes both .started and .failed..."_
   Workflow exits 0 with a `::notice`; nothing fires.

**What this proves:** failed markers are durable across runs; failed phases block readiness globally; operator must intervene.

### Scenario 5 — Operator retry path

1. After scenario 4, manually delete BOTH markers on `main`:
   ```bash
   git rm .session-orchestrator/phase-2.started .session-orchestrator/phase-2.failed
   git commit -m "operator: clear phase 2 markers for retry"
   git push
   ```
2. Restore the kickoff to a working version (or fix the cause of the failure).
3. Trigger the workflow.
4. Expected: phase 2 fires successfully. New `.started` lands (no `.failed`). Success digest.

**What this proves:** the documented retry path works as advertised.

## Acceptance

All five scenarios pass on the sandbox before the orchestrator is pointed at a new consumer. The Day-2 sandbox-smoke gate (2026-05-13) is the canonical baseline run.

## Estimated cost

- Scenario 2 fire: ~$0.05–$0.15 (Haiku + tiny kickoff).
- Scenarios 4+5 fires: ~$0.05–$0.15 each.
- Total sandbox smoke: <$1 across all 5 scenarios. The `max_budget_usd: 0.50` cap in the config is intentional belt-and-suspenders.
