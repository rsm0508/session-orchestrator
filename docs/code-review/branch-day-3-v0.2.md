# Codex review — session-orchestrator v0.2 (Linear-label kill-switch GHA wiring)

- **Target:** uncommitted v0.2 surface — `src/lib/linear-pause-check.ts` (new), CLI command wiring in `next.ts` / `run.ts` / `status.ts`, `LINEAR_API_KEY` propagation in reusable workflow, README + kickoff doc updates, `package.json` version bump.
- **Base:** `9f13230` (Day-3 P1 close commit)
- **Reviewed at:** 2026-05-13
- **Rounds:** R1 + R2 (R2 clean — no further rounds needed)
- **Reviewer:** OpenAI Codex CLI v0.129.0 (gpt-5.5, reasoning=high)
- **Transcripts:** `.codex-output/day-3-v0.2-r1.txt`, `.codex-output/day-3-v0.2-r2.txt`

---

## R1 findings

- [P2] Exclude canceled Linear issues from the pause query — `src/lib/linear-pause-check.ts`

  Codex noted that Linear's state-type taxonomy distinguishes `completed` (Done) from `canceled`. The original query used `state.type.neq: "completed"` which would still match a canceled-but-still-labeled issue. Stale canceled tickets could thereby halt the orchestrator indefinitely.

  [ACCEPTED] Switched to `state.type.nin: ["completed", "canceled"]`. Both terminal states now excluded.

- [P2] Bound the optional Linear API request — `src/lib/linear-pause-check.ts`

  Codex noted that Node 22's fetch (Undici) defaults to a 300-second body timeout. With the Linear path as an optional kill-switch source, a slow-but-not-failing Linear could hang `next`/`run`/`status` (or the reusable workflow's resolver step) for up to five minutes — far longer than the documented "no-op on API error" contract suggests.

  [ACCEPTED] Added an `AbortController` with a 5-second default timeout (configurable via `timeoutMs` option for tests). On abort, the catch block returns `false` — matching the existing no-op-on-error semantics. The `finally` block clears the timer to avoid dangling timers on fast paths.

## R2 findings

R2 found **zero** issues. Verbatim verdict:

> "The staged changes consistently add the Linear-label pause checker to the CLI commands and wire the reusable workflow resolver step to receive the Linear API key. I did not identify a discrete correctness issue introduced by this patch."

## Tests added (along with R1 fixes)

72 vitest tests now pass (was 60 at v0.1.0; +9 in `linear-pause-check.test.ts`, +3 for the R1 fixes):

1. Returns true on a matching issue
2. Returns false on zero matches
3. Returns false on GraphQL errors
4. Returns false on non-OK HTTP status
5. Returns false on network throw
6. Respects a custom label override
7. **(R1)** Query excludes both `completed` and `canceled` states using `nin`
8. **(R1)** Times out via `AbortController` when fetch hangs, returns `false` quickly
9. **(R1)** Clears the timeout on fast paths (no dangling timer)
10–12. `maybeCreateLinearPauseChecker` gating (missing key / missing team / both present)

## Round cap

Not reached. R2 was clean; no R3 needed.
