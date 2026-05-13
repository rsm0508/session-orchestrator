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

Round 1 of 3 complete on artifact `branch-day-2-workflow`. All findings actionable; addressing in a follow-up commit on top of `b2d3cb9`. Re-running codex Round 2 against the fix commit before continuing to sandbox smoke test.
