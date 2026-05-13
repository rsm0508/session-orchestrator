# Headless Claude integration — operator reference

How session-orchestrator drives `claude --print` under the hood. Consolidates the locked product decisions (Day 2 AskUserQuestion rounds) and verified flag shapes (live smoke test).

For raw verification traces see `docs/findings/headless-claude.md`. For CI wiring see `.github/workflows/run-next-phase.yml` and `examples/consumer.github-workflows.orchestrator.yml`.

## Canonical invocation

What `fireHeadlessSession` runs:

```bash
echo "$KICKOFF_CONTENT" | claude -p \
  --bare \
  --input-format text \
  --output-format json \
  --permission-mode bypassPermissions \
  --allowedTools "<from config.allowed_tools>" \
  --no-session-persistence \
  --max-budget-usd <from config.max_budget_usd> \
  --model <from config.claude_model>
```

Env: `ANTHROPIC_API_KEY` REQUIRED (pre-flight checked in `run.ts`). `--bare` mode ignores OAuth and keychain entirely — only `ANTHROPIC_API_KEY` works.

## Why each flag

| Flag                                  | Reason                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p, --print`                         | Headless mode. Skips workspace-trust dialog when stdout isn't a TTY (auto-true under `execa`).                                                       |
| `--bare`                              | Skips auto-memory, plugin sync, CLAUDE.md auto-discovery. Saves ~$0.11/fire vs full-context on trivial prompts. Forces `ANTHROPIC_API_KEY` for auth. |
| `--input-format text`                 | Kickoff is one body of text piped via stdin. (`stream-json` is for structured multi-turn; overkill for one-shot kickoffs.)                           |
| `--output-format json`                | Single JSON envelope on stdout. Parseable by the wrapper for digest construction.                                                                    |
| `--permission-mode bypassPermissions` | No tool-use confirmation prompts. Clearer-intent equivalent of `--dangerously-skip-permissions`.                                                     |
| `--allowedTools <list>`               | Whitelist of tools Claude can call. Config-required; orchestrator REFUSES if `AskUserQuestion` appears (would hang headless).                        |
| `--no-session-persistence`            | Ephemeral run; not saved to `~/.claude` history. Right shape for CI.                                                                                 |
| `--max-budget-usd <cap>`              | Hard $ cap. Session exits with `subtype: "error_max_budget_usd"`, `is_error: true`, exit 1 when hit. Working Principle A guardrail; config-required. |
| `--model <id>`                        | Defaults to `claude-opus-4-7` if config omits. Use `claude-sonnet-4-6` or `claude-haiku-4-5-20251001` for cheaper runs.                              |

## Exit-code semantics

| CLI exit | Meaning                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0        | Success — wrapper's `FireResult.kind === 'success'`.                                                                                                                                                                                                     |
| 2        | Config / pre-check failure (bad YAML, missing handoff, marker collision pre-check, `ANTHROPIC_API_KEY` not set).                                                                                                                                         |
| 3        | Kill switch active (file / env / Linear-label).                                                                                                                                                                                                          |
| 4        | FireFailure — any of: spawn-failure, non-zero-exit, envelope-error (incl. budget exhaust + "Not logged in"), timeout, marker-collision. The `phase-N.failed` marker is written (except for marker-collision, where the in-flight fire owns the markers). |

The GHA workflow uses `continue-on-error: true` on the fire step so it can run the always-on marker-commit + digest-comment steps regardless of fire outcome; a final "Fail the job if fire failed" step exits 1 AFTER all observability has landed.

## Success-determination contract

A fire is "success" iff the wrapper's `FireResult.kind === 'success'`, which requires BOTH:

- `claude` exited 0, AND
- The parsed JSON envelope has `is_error === false`.

**Critical:** `envelope.subtype` is NOT the success signal. `subtype: "success"` can co-exist with `is_error: true` (verified live — e.g., "Not logged in" returns subtype=success, is_error=true). Always check `is_error`.

## The JSON envelope (what the digest reads)

Shape (relevant fields only; some optional):

```json
{
  "type": "result",
  "subtype": "success" | "error_max_budget_usd" | "...",
  "is_error": true | false,
  "result": "<final assistant text>",
  "duration_ms": 12345,
  "duration_api_ms": 9876,
  "num_turns": 3,
  "total_cost_usd": 0.04,
  "session_id": "<uuid>",
  "uuid": "<uuid>",
  "stop_reason": "end_turn" | "...",
  "errors": ["..."],
  "permission_denials": [],
  "modelUsage": { "<model-id>": { "inputTokens": ..., "outputTokens": ..., "costUSD": ... } },
  "api_error_status": null | "...",
  "terminal_reason": "completed" | "..."
}
```

The wrapper persists this raw envelope inside `phase-N-<iso>.result.json` (under the runs/ subdir) alongside the run log and the pre-rendered digest markdown.

## Markers and files written per fire

Under `<repo>/.session-orchestrator/`:

- `phase-N.started` — pre-fire, exclusive create (`flag: 'wx'`). Authoritative duplicate-fire guard.
- `phase-N.failed` — written ONLY on failure paths (not on success, not on marker-collision). Blocks orchestrator readiness globally.
- `runs/phase-N-<iso>.log` — full stdout + stderr capture. Gitignored on the consumer side.
- `runs/phase-N-<iso>.result.json` — structured FireResult JSON for the GHA workflow's digest step. Gitignored.
- `runs/phase-N-<iso>.digest.md` — pre-rendered markdown for the tracking-issue comment. Gitignored.

## What's documented elsewhere

- **Live verification traces** (which test exercised what, raw envelope dumps): `docs/findings/headless-claude.md`.
- **Marker semantics + operator actions** (retry / mark-done-without-retry / why .failed blocks globally): README's "How next phase ready is decided" section.
- **CI wiring** (workflow YAML, consumer template, marker durability contract): CLAUDE.md "Marker durability in CI" + the YAML files themselves.
- **Codex review trail** (3 rounds × 2 artifacts, all findings + triage): `docs/code-review/branch-day-2-headless.md` + `branch-day-2-workflow.md`.
