# Sandbox smoke-test runbook (Day 2 close)

This is the **end-to-end gate** for Day 2 — verifies the headless invocation, reusable workflow, marker durability, and digest comment work together against a real GitHub-hosted consumer repo. Do this BEFORE pointing the orchestrator at ai-viz.

## Why a sandbox

Per the Day 2 kickoff doc: "Test against a sandbox consumer repo (NOT ai-viz yet) with a mock kickoff doc." The sandbox lets us prove the wiring works on a disposable repo where:

- A buggy fire can't disrupt ai-viz's ongoing work.
- The mock kickoff is intentionally tiny (cheap fire — ~$0.05–$0.15 expected with `--bare`).
- The orchestrator's marker semantics, digest comment, retry path are observable end-to-end.

## Prereqs (one-time)

1. **Push session-orchestrator to GitHub.** Roman creates `rsm0508/session-orchestrator` (private initially) and pushes the local `main` branch.

   ```bash
   gh repo create rsm0508/session-orchestrator --private --source=. --remote=origin
   git push -u origin main
   ```

2. **Create a sandbox consumer repo.** Empty private repo, e.g. `rsm0508/orchestrator-sandbox`. Clone locally for setup.

3. **Generate a PAT.** Classic PAT with `repo` scope, or fine-grained PAT with read access to `rsm0508/session-orchestrator`. Required if session-orchestrator stays private. Store as `SESSION_ORCHESTRATOR_PAT` secret in the sandbox repo.

4. **Set sandbox repo secrets:** `ANTHROPIC_API_KEY` (your real key), `SESSION_ORCHESTRATOR_PAT` (the PAT from step 3). In sandbox repo Settings → Secrets and variables → Actions → New repository secret.

5. **Verify default token permissions.** Repo Settings → Actions → General → Workflow permissions → "Read and write permissions" + "Allow GitHub Actions to create and approve pull requests". (The consumer template grants explicit `permissions:` but it can only narrow from this.)

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

### Scenario 3 — Concurrent fire collision (verifies the [P1] R1 race fix)

1. Manually create `.session-orchestrator/phase-2.started` on `main` (sim a stale marker from a crashed prior run):
   ```bash
   echo "stale marker from a hypothetical prior run" > .session-orchestrator/phase-2.started
   git add .session-orchestrator/phase-2.started
   git commit -m "test: simulate stale marker"
   git push
   ```
2. Author `docs/handoffs/sandbox-phase-2-kickoff.md` (any content). Commit + push.
3. Trigger the workflow.
4. Expected: workflow refuses phase 2 with `REFUSED — phase already has a .started marker`. Exit code 4. NO PR created, NO digest comment (no fire happened).

**What this proves:** marker collision detection works; the operator-cleanup path is documented in the log.

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
6. Expected: `session-orchestrator next` reports `phase-failed-blocked` — refuses to advance. Workflow does NOT re-fire phase 2.

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

## Acceptance for Day 2 close

All five scenarios pass on the sandbox. THEN — and only then — open the Day 3 kickoff handoff and start wiring ai-viz as the first real consumer.

## Estimated cost

- Scenario 2 fire: ~$0.05–$0.15 (Haiku + tiny kickoff).
- Scenarios 4+5 fires: ~$0.05–$0.15 each.
- Total sandbox smoke: <$1 across all 5 scenarios. The `max_budget_usd: 0.50` cap in the config is intentional belt-and-suspenders.
