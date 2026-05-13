# Codex review — session-orchestrator Day 2 (wire headless `claude --print` invocation)

- **Target:** `main` (commit `19ed464`)
- **Base:** `050c91c` (Day 1)
- **Reviewed at:** 2026-05-12
- **Round:** 1 of 3
- **Reviewer:** OpenAI Codex CLI v0.129.0 (gpt-5.5, reasoning=high)

---

The core headless firing path can duplicate sessions under concurrent triggers, and the new failed-marker workflow does not match its operator instructions. The required config changes also leave the packaged example unusable for consumers.

Full review comments:

- [P1] Create started markers atomically before firing — `src/lib/headless-claude.ts:177-181`
  When two jobs try to run the same ready phase concurrently, both can pass `run.ts`'s `fs.access` check before either writes the marker, and this `writeFile` uses the default overwrite mode, so both Claude sessions will fire. Since the started marker is the duplicate-run guard, create it exclusively (for example with `flag: 'wx'` and handle `EEXIST`) or move the existence check into this atomic write.

  [ACCEPTED] Real race condition. Concurrent triggers (PR-merge + daily cron firing inside the same minute) are exactly the case session-orchestrator advertises. Fix: switch to `fs.writeFile(path, body, { flag: 'wx' })`; surface `EEXIST` as a typed `MarkerAlreadyExists` error the CLI can render as "phase already in flight, refusing to fire". Keep the cheap `fs.access` pre-check in `run.ts` for the friendly UX path (clean error before doing the kickoff read), but treat the exclusive write as the authoritative guard.

- [P2] Make failed markers affect retry/rollback semantics — `src/lib/digest.ts:101-106`
  This rollback guidance is unsafe because `.failed` markers are not consulted by `resolveNextPhase` or `run`: if an operator deletes only `.started`, the phase again satisfies `handoff present && started absent` and the next scheduled run will retry it anyway, leaving a stale `.failed` marker on success. Either treat `.failed` as blocking readiness until it is deleted or change the retry/rollback instructions to match the actual behavior.

  [ACCEPTED] Path A (treat `.failed` as blocking readiness) — that matches the operator mental model (any marker = "this phase has a story; don't auto-fire"). Concretely: extend `resolveNextPhase` so a phase is ready iff `(handoff present) AND (!started AND !failed)`. Add the `failedMarkerExists` field to `PhaseStatus`. Update `scanPhases` to also probe the `.failed` path. Update tests. The digest/run-output rollback text then matches reality: "delete only `.started`" is the rollback path (phase becomes ready again next tick, `.failed` blocks until deleted) — wait, no, with the new semantics deleting only `.started` STILL leaves the `.failed` blocking. The correct ops shape becomes: "to retry: delete BOTH; to roll back without retry: leave both in place and revert the kickoff content / mark the phase done another way." Update digest text accordingly.

- [P2] Keep the published example config valid — `src/lib/config.ts:24-32`
  Adding these required config keys makes the annotated `examples/.session-orchestrator/config.yml` and the README's required-key list invalid as written; copying the documented example now causes every command that calls `loadConfig` to fail validation before it can run. Update the sample/docs in the same change or provide safe defaults so new consumers can still bootstrap from the packaged example.

  [ACCEPTED] Fold into task 7 (doc-sync) but pull it forward to this fixup pass since the broken example is a "would silently fail for any consumer" trap, not Day-3 polish. Update `examples/.session-orchestrator/config.yml` with `allowed_tools` + `max_budget_usd` (plus inline comments explaining choice + per-tenant guidance). README required-key list update can land alongside.

---

## Triage summary

- 1× [P1] — accepted, fixing inline (race condition).
- 2× [P2] — accepted; both fixing inline (failed-marker semantics + example config validity).
- 0 skipped, 0 deferred to Linear.

## Round status

Round 1 of 3. All 3 findings actionable; addressing in a follow-up commit on top of `19ed464`. Re-running codex Round 2 against the fix commit only if Roman wants a second pass — otherwise close.
