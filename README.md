# session-orchestrator

Autonomous session-orchestration layer that fires fresh Claude Code sessions to advance multi-phase projects between phases — no human between each phase.

**Status:** v0.2.0. CLI, headless Claude invocation, reusable GHA workflow, sandbox-smoke gate, Slack E2E, and Linear-label kill-switch GHA wiring all shipped. First real consumer (Rankwize Cockpit) wires in a dedicated session.

## The problem

You have a multi-phase project. Each phase has a kickoff handoff doc you paste into a fresh Claude Code session. Between phases, you wait — for review, for merge, for the next session to be started by you. That gap is the bottleneck.

`session-orchestrator` closes the gap. It watches your repo, finds the next ready phase, and fires a headless Claude Code session with the kickoff doc as the prompt. The session does its own commits + PR + ticket updates because it has full tool use. The orchestrator stays plumbing.

## How it works (v1.0, target)

1. Consumer repo opts in by dropping a `.session-orchestrator/config.yml` at its root (see `examples/`).
2. Consumer repo adds a thin `.github/workflows/orchestrator.yml` that calls this repo's reusable workflow (`run-next-phase.yml`).
3. On every PR merge to the configured feature branch (event-driven) and once daily (schedule-based safety net), the workflow:
   - Reads the consumer config
   - Scans for the next ready phase (handoff doc exists; no `.session-orchestrator/phase-N.started` marker)
   - Checks kill switches (repo file, env var, Linear label)
   - Fires `claude --print "$(cat <kickoff>)"` headlessly
   - Captures session output, opens PR, posts digest comment on the configured tracking issue

The local CLI mirrors the same logic so you can dry-run, test, and manually trigger from your laptop.

## Install

**Local development (Day 1 — works now):**

```powershell
git clone <this-repo>
cd session-orchestrator
npm install        # `prepare` script auto-runs `npm run build`
npm test
npx session-orchestrator --help
```

**From a consumer repo (Day 2+ — once GHA workflow ships):**

```yaml
# consumer-repo/.github/workflows/orchestrator.yml
name: Orchestrator
on:
  pull_request:
    types: [closed]
    branches: [feat/mcp-v1]
  schedule:
    - cron: '0 9 * * *' # daily safety net
jobs:
  next:
    uses: rsm0508/session-orchestrator/.github/workflows/run-next-phase.yml@main
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }} # optional
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }} # optional
```

## CLI

```
session-orchestrator next                # scan for the next phase ready to fire
session-orchestrator next --dry-run      # same, but don't fire — just report what would happen
session-orchestrator run --phase N       # fire a specific phase (manual override)
session-orchestrator run --phase N --dry-run
session-orchestrator status              # current state (kill switches, in-flight, next phase)
session-orchestrator pause               # flip the kill-switch file
session-orchestrator resume              # clear the kill-switch file
```

All commands assume cwd is the consumer repo root. Pass `--repo <path>` to override.

## Configuration

The consumer config lives at `<consumer-repo>/.session-orchestrator/config.yml`. See `examples/.session-orchestrator/config.yml` for the annotated reference.

Required keys: `project_name`, `feature_branch`, `handoff_pattern` (must contain `{N}`), `max_phase`, `tracking_issue`, `allowed_tools`, `max_budget_usd`.

- `allowed_tools` is passed verbatim to `claude --allowedTools` — space-separated tool names. NEVER include `AskUserQuestion` (orchestrator refuses to start). Typical: `"Read Write Edit Bash Glob Grep"`.
- `max_budget_usd` is the hard $ cap per fire (`claude --max-budget-usd`). Working Principle A guardrail — required, no default.
- `feature_branch` is **PR-target metadata, not a fire-from-this-branch signal.** The orchestrator runs from the consumer's default branch (so marker commits land there); the session itself creates phase-specific branches off the default branch per its kickoff doc, opens PRs targeting `feature_branch`. See CLAUDE.md's "`feature_branch` semantics" section for the full rationale.

Optional: `linear_team`, `claude_model` (default `claude-opus-4-7`).

## Kill switches (3 independent paths — any one halts a run)

| Path         | Where                                                                    | Use when                                                         |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| File in repo | `<consumer-repo>/.session-orchestrator-paused`                           | Per-project pause; lives in the repo so it's visible from inside |
| Env var      | `SESSION_ORCHESTRATOR_PAUSED=true`                                       | Operator-wide pause across every consumer at once                |
| Linear label | `orchestrator-paused` on any open ticket in the configured `linear_team` | Pause from the project-tracking surface without a code change    |

`session-orchestrator pause` creates the file; `resume` removes it. The env and Linear paths are checked at runtime — there's no CLI to flip them.

## How "next phase ready" is decided

A phase N is _ready_ iff:

1. A file matching `handoff_pattern` resolved with `N` exists in the consumer repo
2. Neither `.session-orchestrator/phase-N.started` nor `.session-orchestrator/phase-N.failed` exists
3. No EARLIER phase has a `.failed` marker (one failed phase blocks the whole orchestrator — see below)
4. N ≤ `max_phase`

**Markers and operator actions:**

- The orchestrator writes `phase-N.started` atomically (exclusive create) just before firing the headless session. The exclusive write is the duplicate-fire guard under concurrent triggers.
- On any failure path (non-zero exit, budget exhaust, timeout, "Not logged in", unparseable envelope) the orchestrator also writes `phase-N.failed` next to `.started`.
- A `.failed` marker blocks the whole orchestrator globally — it refuses to advance until an operator resolves it. This is intentional: phase N+1's kickoff usually assumes phase N completed correctly, so silently advancing past a failed phase would mask real problems.
- **To retry a failed phase:** delete BOTH `.started` AND `.failed` on the default branch. The phase becomes ready again next tick.
- **To mark a failed phase done without retrying** (treat the failure as acceptable, advance to next phase): delete only `.failed`. `.started` stays as an audit trail. The next tick will then advance to phase N+1 if ready.

## Why not closed-loop? Why not `/loop`?

- **closed-loop** governs and reviews (PM Council, codex review, digest). It doesn't _start_ fresh Claude sessions. session-orchestrator is the missing primitive in front of closed-loop.
- **Claude Code `/loop`** repeats a prompt on a recurring interval inside one session. session-orchestrator fires _new_ sessions with phase-specific kickoff prompts — different lifecycle, different audit trail.

The three compose: session-orchestrator starts the session, the session uses closed-loop for in-progress review, and `/loop` is for tight intra-session iteration on a single ticket.

## Troubleshooting

Operator-facing failure modes, in roughly the order you'll hit them.

### Workflow run doesn't fire anything

A run that completes successfully without a PR/commit/digest comment usually means **the resolver found nothing to fire**, not a bug. The reasons, in order of likelihood:

| Symptom (in workflow logs)                              | Cause                                                                         | Fix                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `::notice ::Kill switch active`                         | One or more kill-switch paths active                                          | Inspect annotation `details:` for the source list. Flip the named path off (see kill switch precedence below).               |
| `::notice ::Not ready`                                  | Resolver returned `kind=not-ready`                                            | Most common cause: a stale `.session-orchestrator/phase-N.started` or `.failed` marker on the default branch. See below.     |
| Job exited 0, no fire step ran                          | Same as above                                                                 | The `kind == 'ready'` guard skips `fire` + marker-commit + digest steps when resolver says not-ready.                        |
| `No phase resolved as ready: max_phase reached`         | `current_phase > max_phase` in config                                         | Project is complete — bump `max_phase` or stop running the workflow.                                                         |

### Kill-switch precedence

The three paths are checked **in parallel**; **any single active source halts a run**. The orchestrator returns the **full** active-source list (not first-hit) so the digest can tell you exactly what to flip. Order of likelihood when troubleshooting:

1. **File** (`<consumer>/.session-orchestrator-paused`) — most common; survives across runs because it's in git. Run `session-orchestrator resume` locally + commit the deletion, or `gh api -X DELETE repos/<owner>/<repo>/contents/.session-orchestrator-paused`.
2. **Env var** (`SESSION_ORCHESTRATOR_PAUSED=true`) — for GHA runs, set a repo or org **Action Variable** of that name (Settings → Secrets and variables → Actions → Variables). The reusable workflow propagates `vars.SESSION_ORCHESTRATOR_PAUSED` into the resolver process. For local CLI runs, plain `process.env`.
3. **Linear label** (`orchestrator-paused` on any open ticket in `linear_team`) — wired in v0.2. The CLI commands (`next`, `run`, `status`) and the reusable workflow now attach a Linear API checker when **both** `LINEAR_API_KEY` is set in the environment AND `linear_team` is configured. The checker queries Linear for any non-completed issue in that team carrying the `orchestrator-paused` label; finding one halts the run. Missing key, missing team, or API error: no-op (the path returns inactive, the other two paths still work).

### GHA `403` / "could not read Username" on marker push

The reusable workflow needs three things to push the marker commit back:

1. **Workflow-level `permissions:`** — the consumer template grants `contents: write`, `issues: write`, `pull-requests: write`. If your repo has narrower default `GITHUB_TOKEN` permissions, those line items are required (a reusable workflow can narrow but not widen the caller's permissions).
2. **Repo Settings → Actions → General → Workflow permissions** — must be set to "Read and write permissions" + "Allow GitHub Actions to create and approve pull requests".
3. **`gh auth setup-git`** — handled inside the reusable workflow. If you ever fork and modify the marker-push step, retain this — `gh repo clone` leaves `origin` credential-less, and a subsequent `git push` fails with `could not read Username`.

### Marker cleanup

The orchestrator-managed files under `.session-orchestrator/` on the default branch:

| File                                  | Tracked? | Cleanup                                                                                                                    |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `phase-N.started`                     | yes      | Delete to **clear the audit trail** after a successful phase. Optional; safe to leave indefinitely.                        |
| `phase-N.failed`                      | yes      | Delete to **unblock the orchestrator**. A `.failed` marker blocks ALL later phases globally until you intervene.           |
| `runs/phase-N-<iso>.log`              | gitignored | Runner-local; vanishes with the job. Never committed.                                                                    |
| `runs/phase-N-<iso>.result.json`      | gitignored | Same — runner-local.                                                                                                       |
| `runs/phase-N-<iso>.digest.md`        | gitignored | Same — runner-local. The workflow reads it inline to post the issue comment.                                               |

**Retry recipe for a failed phase:** delete BOTH `.started` AND `.failed` on the default branch + commit + push. Phase becomes ready again next tick.

**Skip-past recipe** (treat the failure as acceptable, advance to N+1): delete only `.failed`. `.started` stays as audit trail. Next tick advances if N+1 is ready.

### Headless Claude failure modes

The orchestrator's wrapper categorizes failures into five `reason` codes (see `src/lib/headless-claude.ts`). The digest comment surfaces both the wrapper `reason` and the Claude envelope `subtype` so you can tell apart "Claude exited with an error" from "the wrapper couldn't spawn Claude at all":

| `reason`           | What it means                                                                                                          | Common envelope `subtype`                                  | Operator action                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `marker-collision` | A `.started` marker was written between resolver-check and pre-fire write. True race; rare.                            | n/a (no fire happened)                                     | Delete the stale `.started` if you're certain no fire is in flight. Then re-trigger.                                         |
| `spawn-failure`    | `execa` couldn't start `claude`. Almost always missing CLI or `ANTHROPIC_API_KEY` not set.                             | n/a                                                        | Check the runner's `claude --version` step. Confirm `ANTHROPIC_API_KEY` secret is set on the consumer repo.                  |
| `non-zero-exit`    | Claude exited with a non-zero code.                                                                                    | `error_max_budget_usd` (cap hit), `error_during_execution` | Inspect the run log link in the digest comment. For `error_max_budget_usd`, raise `max_budget_usd` in config or fix the kickoff to be cheaper. |
| `envelope-error`   | Claude exited 0 but the JSON envelope on stdout was unparseable, or `is_error: true` despite exit 0.                   | varies                                                     | Inspect the raw log (referenced in the digest). Usually a CLI-version mismatch — pin `@anthropic-ai/claude-code` in the workflow. |
| `timeout`          | Wrapper-level wall-clock cap (`SESSION_ORCHESTRATOR_TIMEOUT_MS`) elapsed before the session returned.                  | n/a                                                        | Raise the workflow's `timeout-minutes` input (default 30). Wrapper auto-reserves a 5-minute cleanup buffer below that.       |

For the full envelope-shape reference: `docs/findings/headless-claude.md`.

### Install errors

| Symptom                                                                                            | Cause                                                                                                                        | Fix                                                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm install -g <git-url>` succeeds but `session-orchestrator: command not found`                  | npm-10 dangling-symlink trap. The reusable workflow's install step already works around this — only hits you on manual runs. | Use the clone-pack-install recipe from `docs/findings/cloud-install-trap.md`.                    |
| `dist/<file>` not found during local install                                                       | `dist/` is shipped in git for cloud-install reasons; if you rebuilt locally and didn't commit, the package is incoherent.    | `npm run build` regenerates; commit the result.                                                  |
| `claude: command not found` after `npm install -g @anthropic-ai/claude-code`                       | npm's `bin/` directory not on `PATH`, OR the CLI install was cached from a partial run.                                      | `npm root -g`; ensure `$(npm prefix -g)/bin` is on `PATH`. Clear: `npm uninstall -g @anthropic-ai/claude-code && npm install -g ...`. |


## License

MIT — see `LICENSE`.
