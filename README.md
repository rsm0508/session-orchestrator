# session-orchestrator

Autonomous session-orchestration layer that fires fresh Claude Code sessions to advance multi-phase projects between phases — no human between each phase.

**Status:** v0.1.0 pre-release. Day 1 (CLI + core lib) and most of Day 2 (headless Claude invocation wired in `run`) shipped. Day 2 remainder (reusable GHA workflow, consumer template, sandbox smoke) and Day 3 (Slack hook, polish, release tag) outstanding.

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

To be written in Day 3 — install/config errors, kill-switch precedence, GHA permission issues, headless Claude failure modes.

## License

MIT — see `LICENSE`.
