# Day 3 kickoff — session-orchestrator

**Status going in:** Day 1 + Day 2 + Day-2 sandbox-smoke gate all shipped. Toolkit is end-to-end functional on a public sandbox; first real consumer (ai-viz) is unwired. v0.1.0 tag pending.

**Read this first if you're starting a fresh session:**

1. `CLAUDE.md` at the repo root — Working Principles A-F, Codex review protocol, marker convention, locked product decisions.
2. `~/.claude/projects/C--Users-roman-Documents-----FS-Projects-session-orchestrator/memory/project_day_2.md` — Day-2 close state.
3. `docs/sandbox-smoke-test.md` — the runbook (NB: divergences from reality, see "Day-2 sandbox-smoke close" below).
4. `~/.claude/projects/C--Users-roman-Documents-----FS-Projects/memory/feedback_codex_review_rhythm.md` — cross-project Codex review protocol (Working Principle B).
5. This document.

## Decisions locked (2026-05-13)

Surfaced via `AskUserQuestion` at Day-3 session open. These are the operating
assumptions for the rest of Day 3 — do not re-derive without explicit re-approval.

| Q | Decision |
|---|---|
| Q1 | **Keep `rsm0508/session-orchestrator` public.** Remove `SESSION_ORCHESTRATOR_PAT` from consumer template + workflow install step. |
| Q2 | **Tag v0.1.0 BEFORE ai-viz wiring.** ai-viz pins to `v0.1.0` from day one. |
| Q3 | **Slack E2E in scope.** Roman's personal Slack + dedicated `#orchestrator-test` channel; webhook secret on sandbox repo. |
| Q4 | **Reset sandbox to clean state.** Close PRs #4 + #5, delete branches, delete markers, reset config budget. Sandbox stays as a regression-test bed. |
| Q5 | **SHA pins only.** Pin `actions/*` to SHAs in v0.1.0. `npm audit` + actionlint deferred to v0.2. |

## Open product questions (resolved — kept for context)

Five decisions surfaced at Day-3 open. See lock table above for chosen options.

### Q1. `rsm0508/session-orchestrator` visibility — keep public, or revert to private?

We flipped it to public mid-sandbox-smoke (2026-05-13) because `npm install -g github:<private>#<ref>` + the access-policy gate + `SESSION_ORCHESTRATOR_PAT` secret was a recurring failure surface. Public removes the entire PAT subgraph from the consumer template.

- **Keep public** (recommended): simplest consumer setup, no PAT, no access-policy step in the runbook. Aligns with MIT-licensed sharing intent from project memory. Cost: source visible publicly, but it's MIT anyway.
- **Revert to private**: tighter access control. Cost: re-enable PAT path in the reusable workflow, re-add access-policy prereq, re-add PAT secret to every consumer. Re-introduces the failure modes we just removed.

If we keep public, the consumer template still has `SESSION_ORCHESTRATOR_PAT: ${{ secrets.SESSION_ORCHESTRATOR_PAT }}` in its secrets block — that should be removed (it'll resolve to empty string and is dead weight).

### Q2. v0.1.0 release tag timing — before or after ai-viz wiring?

The Day-1 plan put v0.1.0 after ai-viz wiring. With smoke-test green, we could also tag NOW (with the public repo) and have ai-viz pin to the tag from day one.

- **Tag before ai-viz wiring** (recommended): consumers pin to a stable ref; `orchestrator-ref: v0.1.0` is the production-grade default per the existing workflow comment ("Pin to a tag in production"). Re-cuts the install path: clone+pack+install from a tag is identical to from a branch.
- **Tag after ai-viz wiring**: catches any ai-viz-specific surprises before locking the version. Marginal benefit since wiring is mechanical.

### Q3. Slack webhook E2E — test channel?

The reusable workflow's Slack notification step is plumbed but never lit up (no `SLACK_WEBHOOK_URL` secret was set on the sandbox). Day-3 needs to verify the actual POST works.

- **Use Roman's personal Slack workspace** + a dedicated `#orchestrator-test` channel. Tightest blast radius.
- **Use the rankwize workspace** + an existing channel. Real-stakes test; ai-viz fires would post here too.
- **Skip Slack verification entirely**, file as v0.2 work. Defer.

### Q4. Sandbox lifecycle — keep `rsm0508/orchestrator-sandbox` for regression testing?

Sandbox is currently primed with 2 open PRs, 4 digest comments on issue #1, and markers for both phases on `main`. Three options:

- **Keep as-is** for future regression testing. Cost: extra clutter; future test runs need to clean up state every time.
- **Reset to "fresh" state** (close PRs, delete branches, delete markers, reset config budget) — a clean regression-test bed.
- **Delete the sandbox repo entirely.** Future smoke tests bootstrap from scratch using the runbook.

### Q5. Day-2 backlog priority

Three banked traps from Day 2, none load-bearing for ai-viz wiring:

1. **`npm audit` flagged 5 moderate transitive vulns** via vite-node (under vitest).
2. **`actions/*` SHA pins** — workflow uses `@v5` major tags with `TODO(supply-chain)` comment.
3. **`actionlint` CI step** — not yet wired (`@rhysd/actionlint` isn't npm-installable; needs binary or Docker).

Pick which apply before v0.1.0:

- **All three**: thorough but slows down Day 3.
- **SHA pins only** (security-driven; production-grade pinning is the standard ask).
- **Defer all to v0.2**: ship v0.1.0 with banked traps explicitly noted in README.

## Day-2 sandbox-smoke close (2026-05-13)

All 5 scenarios PASSED end-to-end on `rsm0508/orchestrator-sandbox`. Total spend: ~$0.13 across 4 real claude fires.

Four production bugs were caught + fixed during the gate; **Day-2 codex review (3 rounds × 2 artifacts) missed all four** because they only became visible on a live runner.

### Bugs caught + fixed in this session

| # | Bug | Fix | Codex | Commit |
|---|---|---|---|---|
| 1 | `dist/` was gitignored; cloud install had no built JS; `prepare` script's `tsc` failed because devDeps weren't installed | Ship `dist/` in git; drop `prepare` script | R1 clean | `66a514f` |
| 2 | `bin/run.js` mode `100644` in git → Linux exec failed | `git update-index --chmod=+x bin/run.js` | (turned out not to be the load-bearing fix, but harmless) | `2f0e288` |
| 3 | `npm install -g <git-url>` on npm 10.x creates a dangling symlink to the cache's temp clone dir; package never extracted; bin "command not found" | Switch reusable workflow's install step from `npm install -g github:...` to clone-pack-install (`git init` + `git fetch <ref>` + `npm pack` + `npm install -g <tarball>`) | R1: 2 findings (SHA refs broken; transcripts not gitignored); R2: clean | `8753b48` |
| 4 | Marker-commit step's `git push` failed with "could not read Username" — `gh repo clone` doesn't configure git credentials for subsequent push | Add `gh auth setup-git` between `cd "$MARKER_CLONE"` and `git config user.name` | R1: clean | `aeb73e7` |

### Runbook divergences from reality — `docs/sandbox-smoke-test.md` is stale

- **Prereqs §3 (PAT)** — no longer needed if Q1 lands on "keep public." Should be conditional.
- **Prereqs §4-5** — `SESSION_ORCHESTRATOR_PAT` secret and "Access" policy prerequisite both removable if public.
- **Scenario 3 expectation** — runbook says "REFUSED — phase already has a .started marker, exit 4." Reality: the resolver short-circuits at "kind=not-ready" with exit 0 + a `::notice` annotation. The wrapper-level REFUSED path only fires on a true race condition (resolver said ready, then `.started` appears before the wrapper writes its own) and isn't reachable from a single `workflow_dispatch`.
- **Scenario 4 part 2 (re-trigger)** — runbook says `phase-failed-blocked`. Actual annotation is more human-readable: `"Phase 2 has a .failed marker at .session-orchestrator/phase-2.failed — orchestrator refuses to advance until an operator deletes both .started and .failed..."`

Day 3 should rewrite `docs/sandbox-smoke-test.md` to match observed behavior, OR add a "what actually happens vs. expected" section.

### Lessons (lock these in CLAUDE.md or its own memory)

1. **Codex review needs a live workflow run** before declaring a CI workflow shipped. Static review (Day-2 R1/R2/R3 on the workflow) missed all four cloud-install bugs. Day-3 followup: add a "live-run-before-merge" step to Working Principle B for CI workflows specifically.
2. **Phase kickoff docs are prompts, not docs.** Meta-narrative ("if you see this running, scenario X has regressed") will be read and obeyed by claude. Keep kickoffs as direct task instructions; put meta-context in a separate file or a comment block claude is told to ignore.
3. **The npm-10 git-URL install bug is worth its own findings doc.** Without it, Day-3+ contributors hitting the same dangling-symlink will re-litigate the diagnosis. Create `docs/findings/cloud-install-trap.md` with the Docker repro and the clone-pack-install fix.

## Day 3 work items (in priority order)

After Q1-Q5 are answered:

### P1 — must ship for v0.1.0

1. **Apply Q1 decision.** If public: remove `SESSION_ORCHESTRATOR_PAT` reference from `examples/consumer.github-workflows.orchestrator.yml`; remove the PAT branch in `.github/workflows/run-next-phase.yml`'s install step (it's currently dead but reads as supported). If private: revert (see Q1).
2. **Fix runbook (`docs/sandbox-smoke-test.md`)** to match actual behavior. See divergences list above.
3. **Author `docs/findings/cloud-install-trap.md`** with the npm-10 dangling-symlink repro + fix rationale.
4. **README troubleshooting section.** Operator-facing failure modes: kill-switch precedence, GHA permission issues, marker cleanup paths, headless claude failure modes (subtype `error_max_budget_usd`, etc. — pull from `headless-claude.ts`).
5. **Codex review** of the above changes (R1; aim for clean, file remaining findings to a Day-4 doc).
6. **v0.1.0 tag** (timing per Q2).

### P2 — required before ai-viz wiring

7. **Wire ai-viz as first real consumer.** Separate small PR on `ai-viz` repo:
   - `.session-orchestrator/config.yml` (tracking RAN-XXX as the issue; copy from sandbox example, adapt feature_branch + max_phase + tracking_issue + budget)
   - `.github/workflows/orchestrator.yml` (copy + adapt the consumer template; reference `rsm0508/session-orchestrator/.github/workflows/run-next-phase.yml@v0.1.0`)
   - Dry-run first via `workflow_dispatch`. Real fire only after Roman approves.

### P3 — backlog

8. `npm audit` — try `npm install --save-dev vitest@latest` and re-run tests. If still flagged, escalate. (Q5: deferred to v0.2)
9. ~~`actions/*` SHA pins~~ — shipped in v0.1.0 (Q5).
10. `actionlint` CI step — install the binary in a new `.github/workflows/lint-workflows.yml`. (Q5: deferred to v0.2)
11. ~~Wire Linear-label kill-switch in GHA runtime~~ — **shipped in v0.2** (see `src/lib/linear-pause-check.ts`). CLI commands (`next`, `run`, `status`) attach a Linear API checker when both `LINEAR_API_KEY` is set AND `linear_team` is configured. Reusable workflow propagates `LINEAR_API_KEY` into the resolver step.

### Cleanup (small, opportunistic)

- `.codex-output/` is gitignored (added 2026-05-13). Existing transcripts (`day-2-cloud-install-fixes-r1.txt`, `day-2-clone-pack-install-r{1,2}.txt`, `day-2-marker-push-auth-r1.txt`) can be left untracked or deleted.
- The sandbox repo's PR #4 + #5 are smoke-test artifacts; close them out per Q4 decision.

## Codex review protocol reminder

(Same as Day 2 — repeated here so a fresh session doesn't have to chase pointers.)

```bash
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=safe.directory \
GIT_CONFIG_VALUE_0="C:/Users/roman/Documents/____FS/Projects/session-orchestrator" \
  codex review --uncommitted --title "<short-title>" 2>&1 | tee ".codex-output/<artifact>-r<N>.txt"
```

- Foreground only on Windows (background = 0-byte output).
- 3-round cap per artifact; round 3 findings → tracking doc, not round 4.
- For CI workflows: **add a live workflow run** as part of the review, not just static.

## Current state snapshot

- `rsm0508/session-orchestrator` — public, MIT, HEAD = `aeb73e7` on `main`.
- `rsm0508/orchestrator-sandbox` — private, in post-smoke state (4 digest comments on issue #1, PRs #4 + #5 open from smoke runs, both phase markers on main).
- Auto-memory: `project_day_2.md` is canonical for Day-2 close; this kickoff supersedes it for Day-3 planning.
- Node 22, npm 10.9.7 verified working on the runner; Node 22.22.2 + npm 10.9.7 confirmed locally in `node:22` Docker image.

## Acceptance for Day 3 close

- [x] Q1-Q5 answered + locked in this doc (see top decisions table).
- [x] All P1 items shipped + codex-reviewed (R1+R2, see `docs/code-review/branch-day-3-p1.md`).
- [x] v0.1.0 tag exists on `rsm0508/session-orchestrator` (commit `dbbff95`, pushed).
- [x] Slack webhook E2E verified end-to-end on sandbox (Q3 follow-through; webhook rotated post-verification because the URL surfaced in the working transcript).
- [x] Sandbox repo reset per Q4 (PRs closed, branches deleted, markers cleared, orchestrator.yml pinned to `@v0.1.0`).
- [~] ai-viz wiring — **DEFERRED to a dedicated session.** Roman's call: first real consumer will be a new **Rankwize Cockpit** project (internal PM/CS dashboard — LLM-usage tracking by run type, usage-trend reports, user feedback + feature requests, critical-warning email routing to Roman/Bilal). The cockpit lives on `feat/cockpit` (worktree-isolated from MCP work). Its first phase-1-kickoff handoff doc is produced by a vision-round in a separate session, not in Day-3 close. Orchestrator wiring lands when that kickoff exists.
- [x] `project_day_3.md` written to auto-memory at close.
- [x] `MEMORY.md` index entry for `project_day_3.md`.

---

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
