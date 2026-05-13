# session-orchestrator

Autonomous session-orchestration layer that fires fresh Claude Code sessions to advance multi-phase projects between phases — no human between each phase.

**Status:** v0.1.0 pre-release. Day 1 scope (CLI + core lib) shipped; Day 2 (GitHub Actions wiring + headless Claude invocation) and Day 3 (observability + README polish) outstanding. See `docs/handoffs/day-2-kickoff.md`.

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
    - cron: '0 9 * * *'  # daily safety net
jobs:
  next:
    uses: rsm0508/session-orchestrator/.github/workflows/run-next-phase.yml@main
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      LINEAR_API_KEY:    ${{ secrets.LINEAR_API_KEY }}   # optional
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

Required keys: `project_name`, `feature_branch`, `handoff_pattern` (must contain `{N}`), `max_phase`, `tracking_issue`.

Optional: `linear_team`, `claude_model` (default `claude-opus-4-7`).

## Kill switches (3 independent paths — any one halts a run)

| Path | Where | Use when |
|---|---|---|
| File in repo | `<consumer-repo>/.session-orchestrator-paused` | Per-project pause; lives in the repo so it's visible from inside |
| Env var | `SESSION_ORCHESTRATOR_PAUSED=true` | Operator-wide pause across every consumer at once |
| Linear label | `orchestrator-paused` on any open ticket in the configured `linear_team` | Pause from the project-tracking surface without a code change |

`session-orchestrator pause` creates the file; `resume` removes it. The env and Linear paths are checked at runtime — there's no CLI to flip them.

## How "next phase ready" is decided

A phase N+1 is *ready* iff:
1. A file matching `handoff_pattern` resolved with `N+1` exists in the consumer repo
2. No file at `.session-orchestrator/phase-{N+1}.started` exists yet
3. N+1 ≤ `max_phase`

The `started` marker is written by the orchestrator just before it fires the headless session — that's how it tracks what's already been kicked off. Removing the marker is a manual rollback path.

## Why not closed-loop? Why not `/loop`?

- **closed-loop** governs and reviews (PM Council, codex review, digest). It doesn't *start* fresh Claude sessions. session-orchestrator is the missing primitive in front of closed-loop.
- **Claude Code `/loop`** repeats a prompt on a recurring interval inside one session. session-orchestrator fires *new* sessions with phase-specific kickoff prompts — different lifecycle, different audit trail.

The three compose: session-orchestrator starts the session, the session uses closed-loop for in-progress review, and `/loop` is for tight intra-session iteration on a single ticket.

## Troubleshooting

To be written in Day 3 — install/config errors, kill-switch precedence, GHA permission issues, headless Claude failure modes.

## License

MIT — see `LICENSE`.
