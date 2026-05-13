# Codex review — session-orchestrator Day 2 (reusable GHA workflow + consumer template)

- **Target:** commit `b2d3cb9`
- **Base:** `fe928a0` (the doc-close commit from the previous artifact)
- **Reviewed at:** 2026-05-12
- **Round:** 1 of 3
- **Reviewer:** OpenAI Codex CLI v0.129.0 (gpt-5.5, reasoning=high)

This is a separate artifact from `branch-day-2-headless.md` — the 3-round cap restarts for the workflow code.

---

The workflow has several correctness issues that can cause successful phases to be re-fired, marker commits to land on the wrong branch, or Claude sessions to be unable to open PRs. These affect the core orchestration behavior rather than just optional polish.

Full review comments:

- [P1] Add only existing marker files — `.github/workflows/run-next-phase.yml:161`
  On a successful fire the wrapper writes `phase-N.started` but not `phase-N.failed`. With bash's default globbing, the unmatched `.failed` glob is passed literally to `git add`, causing that command to fail; the `|| true` then lets the step continue without reliably staging the `.started` marker, so the next tick can fire the same phase again. Enable nullglob or add only files that actually exist.

  [ACCEPTED] Real bug — undermines the R3 [P1] marker-durability acceptance criterion the workflow was supposed to fulfill. Fix: use `find` for explicit existence-based discovery (cross-platform reliable; doesn't require `shopt -s nullglob` portability concerns). Build a list of actual marker files, stage each by name.

- [P1] Restore the marker branch before committing — `.github/workflows/run-next-phase.yml:165-166`
  Because `session-orchestrator run` gives Claude the same checkout and the product expects the session to create a branch/PR, the run can return with `HEAD` on the phase branch. In that scenario these lines commit the marker on top of the phase commits and then push that entire `HEAD` to `${{ github.ref_name }}`, fast-forwarding the target branch with unreviewed code or failing on protected branches. Commit markers from an isolated clean checkout/ref instead of whatever branch Claude leaves behind.

  [ACCEPTED] Branch-state pollution. Architecturally severe — could push unreviewed code to the consumer's default branch. Fix: temp-clone the default branch into a side directory (`mktemp -d` + `gh repo clone --depth 1 --branch ${default}`), copy marker files there, commit + push from that guaranteed-clean clone. The main workspace is left alone (the session's branch work + PR remain intact).

- [P1] Check out a single canonical marker branch — `.github/workflows/run-next-phase.yml:72-78`
  With the provided `pull_request.closed` trigger, `actions/checkout` defaults to the PR base ref such as `feat/mcp-v1`, while scheduled/manual runs default to the repository default branch. Since marker state is read from whichever branch was checked out and later pushed to `github.ref_name`, the daily safety-net run can miss markers written by a PR-triggered run and re-fire an already-started phase. Check out and push one canonical marker branch for every trigger.

  [ACCEPTED] Marker divergence across triggers. Fix: explicitly set `ref: ${{ github.event.repository.default_branch }}` on the initial checkout. All triggers (PR-merge, cron, workflow_dispatch) now share one marker view.

- [P2] Export the workflow token to Claude — `.github/workflows/run-next-phase.yml:139-140`
  The Claude process only receives `ANTHROPIC_API_KEY`. GitHub Actions exposes the token via contexts, not automatically as `GH_TOKEN`/`GITHUB_TOKEN`, so when a kickoff asks the headless session to run `gh pr create` or call the API, it will be unauthenticated despite the workflow requesting `pull-requests: write`. Pass the workflow token into this step if sessions are expected to open PRs.

  [ACCEPTED] Without GH auth in env, the session can't fulfill its core job (commit, push, open PR). Fix: add `GH_TOKEN` AND `GITHUB_TOKEN` (some tools read one, some the other) to the fire step's env block. The token already has `contents:write` + `pull-requests:write` + `issues:write` from the workflow's `permissions:` block.

---

## Triage summary

- 3× [P1] — all accepted, fixed inline.
- 1× [P2] — accepted, fixed inline.
- 0 skipped, 0 deferred.

## Round status

Round 1 of 3 complete on artifact `branch-day-2-workflow`. All findings addressed in commit `e4e1a93`.

---

# Codex review — Round 2

- **Target:** commits `b2d3cb9` + `e4e1a93`
- **Base:** `fe928a0`
- **Reviewed at:** 2026-05-12
- **Round:** 2 of 3

The workflow can lose marker durability on long-running sessions because the outer job timeout can kill cleanup, and the consumer template can run with insufficient token permissions in read-only-default repositories. These issues can break the core orchestration path.

Full review comments:

- [P1] Reserve cleanup time before the job timeout — `.github/workflows/run-next-phase.yml:67`
  With the default 30-minute job timeout, the timer starts before checkout/npm installs, while `session-orchestrator run` can wait up to its own 30-minute timeout. Any phase that runs longer than the remaining job budget is killed by Actions before `.failed` is written and before the always-run marker commit/digest steps execute, so the next tick sees no durable marker and re-fires the phase. Give the job a cleanup buffer or pass a shorter `SESSION_ORCHESTRATOR_TIMEOUT_MS` than the job timeout.

  [ACCEPTED] Real interplay bug — undermines R3 [P1] marker durability under long sessions. Fix: pass `SESSION_ORCHESTRATOR_TIMEOUT_MS = (inputs.timeout-minutes - 5) * 60 * 1000` as env to the fire step. Wrapper-internal timeout is now strictly less than the job timeout; the 5-minute buffer reserves time for the always-run marker commit + digest comment + Slack ping. The wrapper-internal env knob `SESSION_ORCHESTRATOR_TIMEOUT_MS` already exists (Day 1 design); this just wires it from the workflow.

- [P2] Grant write scopes in the caller template — `examples/consumer.github-workflows.orchestrator.yml:49`
  When a consumer copies this template into a repo/org whose default `GITHUB_TOKEN` is read-only, this calling job never grants the write scopes the reusable workflow needs; a called workflow cannot elevate the token above the caller's permissions. The marker push, tracking-issue comment, and Claude PR/push operations will fail even though the reusable workflow has its own `permissions` block. Add `contents`, `issues`, and `pull-requests` write permissions to the caller job or workflow.

  [ACCEPTED] Critical for cold-install in any modern repo. GitHub's default GITHUB_TOKEN is read-only on newer org/repo settings; a called reusable workflow can NARROW from the caller's grant but never WIDEN. Fix: add `permissions: { contents: write, issues: write, pull-requests: write }` to the caller template's `jobs.fire:` block, with an inline comment explaining the caller-vs-callee permission relationship. Without this fix, the workflow silently 403s on every push/comment despite the reusable workflow's own permissions block being correct.

## R2 triage summary

- 1× [P1] — accepted, fixed (cleanup buffer via SESSION_ORCHESTRATOR_TIMEOUT_MS).
- 1× [P2] — accepted, fixed (consumer template explicit permissions).
- 0 skipped, 0 deferred.

Round 2 of 3 complete on artifact `branch-day-2-workflow`. R3 will verify convergence.
