# Codex review — session-orchestrator Day 3 P1

- **Target:** uncommitted Day-3 P1 surface — PAT removal, runbook fix, `docs/findings/cloud-install-trap.md`, README troubleshooting, `actions/*` SHA pins
- **Base:** `2760b44` (Day-3 kickoff commit)
- **Reviewed at:** 2026-05-13
- **Rounds:** R1 + R2 (no R3 needed — remaining open finding is a deliberate SKIP)
- **Reviewer:** OpenAI Codex CLI v0.129.0 (gpt-5.5, reasoning=high)
- **Transcripts:** `.codex-output/day-3-p1-r1.txt`, `.codex-output/day-3-p1-r2.txt`

---

## R1 findings

- [P2] Retain optional `SESSION_ORCHESTRATOR_PAT` secret in the reusable workflow API — `.github/workflows/run-next-phase.yml:41-45`

  Codex's argument: existing consumer workflows copied from the previous template might still pass `SESSION_ORCHESTRATOR_PAT`; GitHub validates declared workflow_call secrets at plan time and rejects calls with "secret is not defined in the referenced workflow."

  [SKIPPED — pre-v0.1.0; no real consumers exist] The only "existing consumer" today is `rsm0508/orchestrator-sandbox`, which Q4 says reset to clean state as part of Day-3 work (its orchestrator.yml will be regenerated from the new template). ai-viz hasn't been wired yet. CLAUDE.md guidance "Avoid backwards-compatibility hacks like ... re-exporting types" applies — keeping a no-op secret declaration just for hypothetical compatibility violates YAGNI. Will revisit if a real public consumer is wired before v0.1.0 ships.

- [P2] Don't advertise unwired kill-switch paths — `README.md:137-139`

  Codex flagged that the new troubleshooting section names env-var + Linear-label paths as functional in GHA runs, but the reusable workflow never propagates `vars.SESSION_ORCHESTRATOR_PAUSED` into the resolver process and the CLI's `next.ts` calls `checkKillSwitch({ repoRoot })` without a `checkLinearLabel` callback.

  [ACCEPTED — partial fix] Two-part remediation:
   1. **Env-var path wiring (fixed).** Added an `env:` block to the "Resolve next ready phase" step in `.github/workflows/run-next-phase.yml` that maps `vars.SESSION_ORCHESTRATOR_PAUSED` into the process env. The lib's existing truthy-check then halts the run.
   2. **Linear-label path (deferred to v0.2).** Reworded the README troubleshooting section: the lib seam exists but no caller attaches a checker in v0.1.0 (corrected via R2 — first softening was still inaccurate). v0.2 task tracked at `docs/handoffs/day-3-kickoff.md` P3.11.

## R2 findings

- [P2] Preserve the optional PAT secret in the workflow API — `.github/workflows/run-next-phase.yml:41-45`

  [SKIPPED — same rationale as R1-F1] Codex re-asserted the compat-preservation argument. The triage stands: there are no consumers whose workflows would break. Recording the repeat so a future reviewer doesn't re-litigate.

- [P2] Don't claim Linear labels pause the local CLI — `README.md:139`

  Codex caught a residual accuracy bug in my R1 softening: I'd written "this path activates from local CLI invocations only," but the CLI also never attaches `checkLinearLabel`. The truth in v0.1.0 is "Linear path is a lib seam with no caller, anywhere."

  [ACCEPTED] Rewrote README §kill-switch path 3 to state plainly: seam exists, no caller (CLI or GHA) attaches one in v0.1.0, label is a no-op until v0.2 wiring lands.

---

## Round cap

R3 not run. R1+R2 surfaced 4 findings total; 2 were the same SKIP-rationale PAT compat issue, 2 were the kill-switch accuracy issue progressively narrowed. No outstanding ACCEPTED items remain. The remaining SKIPPED PAT finding is recorded here per protocol — moving to R3 would only repeat it.

## Lessons recorded back into auto-memory

- Codex frequently re-flags compat-preservation arguments after a SKIP. The protocol absorbs this via the round cap; documenting the rationale here once is enough.
- Documentation written for an *intended* product surface (kill switches) can outpace the *actually wired* surface. Codex caught the env+Linear gap precisely because the README troubleshooting section newly exposed it. Lesson: when adding operator-facing docs, grep the actual call sites for the seams the docs describe.
