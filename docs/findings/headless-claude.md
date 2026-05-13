# Findings — `claude --print` headless verification

**Date:** 2026-05-12
**CLI version under test:** Claude Code 2.1.140 (Windows, npm global install)
**Purpose:** Verify the assumptions in `docs/handoffs/day-2-kickoff.md` §1 before wiring the headless invocation.

## TL;DR

`claude -p` is fit for orchestrator use. The canonical invocation shape for CI is:

```sh
cat <kickoff.md> | claude -p \
  --bare \
  --input-format text \
  --output-format json \
  --permission-mode bypassPermissions \
  --allowedTools "<comma-or-space-separated>" \
  --no-session-persistence \
  --max-budget-usd <cap> \
  --model <id>
```

`ANTHROPIC_API_KEY` MUST be set in the env. The CLI returns when the session finishes, exits 0 on success / 1 on budget-exhaust or error, and emits a single JSON envelope to stdout that the orchestrator can parse for the digest comment.

## Flag-shape facts (from `claude --help`, version 2.1.140)

| Flag                                       | Confirmed shape                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p, --print`                              | Headless mode. Workspace-trust dialog is auto-skipped when stdout is not a TTY.                                                                                                                                                                               |
| `--allowedTools` / `--allowed-tools`       | Both spellings work. Comma- or space-separated. Format: `"Bash(git *) Edit Write"`.                                                                                                                                                                           |
| `--disallowedTools` / `--disallowed-tools` | Both spellings; mirror shape.                                                                                                                                                                                                                                 |
| `--input-format`                           | `text` (default — stdin is the prompt body) or `stream-json` (structured turn-by-turn protocol).                                                                                                                                                              |
| `--output-format`                          | `text` (default), `json` (single envelope), `stream-json` (realtime).                                                                                                                                                                                         |
| `--permission-mode`                        | `acceptEdits` / `auto` / `bypassPermissions` / `default` / `dontAsk` / `plan`. For unattended CI, **`bypassPermissions`** is correct.                                                                                                                         |
| `--bare`                                   | Skips hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, CLAUDE.md auto-discovery. **Forces `ANTHROPIC_API_KEY` (or `apiKeyHelper` via `--settings`) for auth — OAuth and keychain are never read.** Mandatory for CI. |
| `--max-budget-usd`                         | `--print`-only. Hard $ cap. Session exits with `subtype: "error_max_budget_usd"`, `is_error: true`, exit code 1. **Working Principle A guardrail — set this per-consumer in config.**                                                                         |
| `--no-session-persistence`                 | Ephemeral run, not saved to `~/.claude` history. Right shape for CI.                                                                                                                                                                                          |
| `--fallback-model`                         | Auto-fallback when primary overloaded. Cheap insurance for cron-triggered runs.                                                                                                                                                                               |
| `--dangerously-skip-permissions`           | Equivalent to `--permission-mode bypassPermissions`. Prefer the latter — clearer intent.                                                                                                                                                                      |

## Behavioral verification (live smoke tests)

### Test 1 — stdin pipe + tool-use auto-allow

**Setup:** Tmp dir with `kickoff.md` instructing Claude to call `Write` to create `out.txt` containing exactly `headless-ok`, then reply `DONE`.

**Command:**

```sh
cat kickoff.md | claude -p --input-format text --output-format text \
  --allowedTools "Write" --permission-mode bypassPermissions \
  --no-session-persistence --max-budget-usd 0.50
```

**Result:**

- Stdout: `DONE`
- Exit code: `0`
- `out.txt` written with exactly `headless-ok` (11 bytes, no trailing newline).
- No interactive prompts. No hangs.

**Conclusion:** stdin-pipe shape + `bypassPermissions` + scoped `--allowedTools` work as a closed loop. Tool calls happen without confirmation prompts, the CLI returns cleanly when the assistant emits its final message.

### Test 2 — JSON envelope shape (without `--bare`)

**Setup:** Trivial "Reply with PONG and exit, no tools" kickoff piped to `claude -p --output-format json`. No `--bare`, so the CLI loaded my local `~/.claude` context (auto-memory + CLAUDE.md auto-discovery + plugin sync).

**Result:** Hit the `--max-budget-usd 0.10` cap on the first turn (Opus cache-loaded the 21k+ token user context). Envelope:

```json
{
  "type": "result",
  "subtype": "error_max_budget_usd",
  "duration_ms": 2357,
  "duration_api_ms": 943,
  "is_error": true,
  "num_turns": 1,
  "stop_reason": "end_turn",
  "session_id": "aae460a8-…",
  "total_cost_usd": 0.11314600000000001,
  "usage": { "input_tokens": 0, "cache_creation_input_tokens": 0, … },
  "modelUsage": {
    "claude-haiku-4-5-20251001": { "inputTokens": 366, "outputTokens": 13, "costUSD": 0.000431, … },
    "claude-opus-4-7[1m]": { "inputTokens": 5, "outputTokens": 7, "cacheReadInputTokens": 21480, "cacheCreationInputTokens": 16284, "costUSD": 0.11271, … }
  },
  "permission_denials": [],
  "fast_mode_state": "off",
  "uuid": "e3d453b8-…",
  "errors": ["Reached maximum budget ($0.1)"]
}
```

**Conclusion:** Two things.

1. The envelope is rich enough for a fixed-template digest: `is_error`, `subtype`, `total_cost_usd`, `num_turns`, `duration_ms`, `session_id`, `uuid`, `errors`, `permission_denials`, per-model breakdown.
2. **Without `--bare`, the CLI eats ~$0.11 just loading local context on a trivial prompt** — completely wrong shape for CI. `--bare` is non-optional.

### Test 3 — `--bare` mode + auth boundary

**Setup:** Same trivial PONG kickoff, this time with `--bare`. My local env has Claude Code authed via OAuth (not `ANTHROPIC_API_KEY`).

**Result:**

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": true,
  "api_error_status": null,
  "duration_ms": 40,
  "num_turns": 1,
  "result": "Not logged in · Please run /login",
  "stop_reason": "stop_sequence",
  "session_id": "…",
  "total_cost_usd": 0,
  "permission_denials": [],
  "terminal_reason": "completed",
  …
}
```

**Conclusion:** `--bare` ignored my OAuth (as documented) and exited cleanly with a "Not logged in" message in the `result` field. **In CI, set `ANTHROPIC_API_KEY` from a secret; no other auth path is read in `--bare` mode.** Note that `subtype: "success"` co-existed with `is_error: true` and a "Not logged in" result — the orchestrator must check `is_error`, not `subtype`, when deciding success vs failure.

## Decisions locked

| Q                    | Answer                                                                                                                   | Source                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| **Invocation shape** | stdin pipe, `--input-format text`                                                                                        | AskUserQuestion 2026-05-12 + Test 1 |
| **Permission flag**  | `--permission-mode bypassPermissions` (clearer than `--dangerously-skip-permissions`)                                    | Test 1                              |
| **CI overhead mode** | `--bare` mandatory; `ANTHROPIC_API_KEY` from GHA secret                                                                  | Test 3                              |
| **Output format**    | `--output-format json` — parseable single envelope drives digest comment                                                 | Test 2                              |
| **Budget cap**       | `--max-budget-usd <cap>` — surface as `max_budget_usd` in `.session-orchestrator/config.yml` (zod-required, no default)  | Test 2                              |
| **Ephemerality**     | `--no-session-persistence`                                                                                               | logical; not separately tested      |
| **Tool allowlist**   | `--allowedTools` from `.session-orchestrator/config.yml` (config-driven, zod-required). Never include `AskUserQuestion`. | Test 1                              |
| **Success check**    | `is_error === false` in the JSON envelope (NOT `subtype`) AND exit code 0                                                | Test 3                              |

## Open / deferred items

- **`AskUserQuestion` in a headless session — not separately tested.** Defending by exclusion: never list it in `--allowedTools`, and pre-flight every kickoff to ensure all decisions are made upfront. The orchestrator's value prop is "no human in the loop between phases" — any kickoff that needs to ask the operator is malformed.
- **`--input-format stream-json`** not exercised. Default `text` covers the one-shot kickoff case; revisit only if a future phase needs multi-turn input.
- **`--output-format stream-json`** not exercised. Would enable a "live tail" to the digest comment, but adds streaming-parser complexity. Defer to Day 3+ if Roman wants real-time visibility.
- **Tool-deny behavior** (kickoff asks Claude to use a tool not in `--allowedTools`) — not separately tested. Inferred from the `permission_denials` field in the JSON envelope: the CLI tracks denials and surfaces them in the digest. The session does NOT hang on a denied tool — it proceeds and reports.
