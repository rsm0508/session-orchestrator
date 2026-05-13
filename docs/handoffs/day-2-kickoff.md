# session-orchestrator Day 2 — GHA workflow + headless Claude wiring

**Ticket:** none yet (Roman to file in his preferred tracker once the repo lands on GitHub).
**Branch:** main (no long-lived feature branch — this is a small, self-contained project).
**Spec:** the original brief at the top of the Day 1 chat transcript (canonical until a `docs/spec.md` lands). The `docs/handoffs/` directory IS the rolling spec for now.
**Expected duration:** ~1 day.

---

## What Day 1 shipped

- Repo skeleton with `prepare`-script (git-installable end-to-end): `package.json`, `tsconfig.json`, `bin/run.js` (oclif shim), `src/index.ts`, `.gitignore`, MIT `LICENSE`, `.prettierrc.json`, `README.md` skeleton.
- Core lib at `src/lib/`:
  - `config.ts` — YAML loader + zod-strict schema (`project_name`, `feature_branch`, `handoff_pattern` with required `{N}`, `max_phase`, `tracking_issue`; optional `linear_team`, `claude_model` default `claude-opus-4-7`).
  - `phase-resolver.ts` — scans the consumer repo for the first phase where `handoff present && marker absent`.
  - `kill-switch.ts` — checks 3 paths in parallel (file `.session-orchestrator-paused`, env `SESSION_ORCHESTRATOR_PAUSED`, `checkLinearLabel` seam). Returns ALL active sources, not first-hit, so the digest can tell the operator exactly what to flip.
  - `repo.ts` — resolves `--repo` flag (absolute / relative / cwd default).
- CLI commands at `src/commands/`: `next`, `run`, `status`, `pause`, `resume`. All support `--repo` + `--dry-run` where relevant.
- 27 unit tests (vitest), green: `config` (9), `phase-resolver` (9), `kill-switch` (9).
- Manual sandbox smoke test against a temp repo mirroring ai-viz's shape — all 7 CLI scenarios behave correctly.
- Day 2 hard-stop in `src/commands/run.ts`: non-dry-run `run` exits with code 4 and a pointer to this doc. Day 2's job is to replace that hard-stop with the headless invocation.

## Open product questions — surface to Roman BEFORE coding

Use `AskUserQuestion` in one batch.

1. **GitHub Actions runner image.** `ubuntu-latest` is the default. Question: do we need a Windows runner anywhere? Anthropic's Claude Code CLI is cross-platform but the consumer repo's build/test/lint may not be. Recommendation: **ubuntu-latest** for the orchestrator workflow itself; if a consumer repo's session needs Windows, that's the consumer workflow's concern.
2. **Claude Code CLI install method in the runner.** Options: (a) `npm install -g @anthropic-ai/claude-code` (canonical, cached well), (b) a pinned Docker image, (c) `curl <install.sh> | bash` (community pattern). Recommendation: **(a)**.
3. **Headless invocation shape: stdin pipe vs `--print "..."` arg.** Long kickoff docs (mcp-phase-1 is ~7KB) may exceed shell-arg limits on some runners. Recommendation: **stdin pipe** (`cat <kickoff> | claude -p`), with a small CLI flag (e.g., `--input-format=stream-json`) considered if Anthropic's docs surface a better shape.
4. **Marker write timing — pre-fire vs on-success.** Pre-fire (Day 1 stub assumes this) means a session crash leaves a marker that blocks retry; on-success means duplicate fires possible if the workflow is triggered twice during a long session. Recommendation: **pre-fire + an explicit `phase-N.failed` marker on non-zero exit** so the operator can either retry (delete `.failed`) or roll back (delete `.started`).
5. **Tracking-issue comment shape.** Two trade-offs:
   - Fixed-template summary (run id, phase, model, exit code, PR link if found) — easy to scan, hard to evolve.
   - Free-form summary captured from the session's stdout tail — richer but variable.
   Recommendation: **fixed template + a fold-out "session tail" details block** (best of both).

Resolve these five before writing the workflow YAML.

## Scope

### 1. Claude Code `--print` verification (Working Principle E — new pattern)

**Before** writing the workflow, prove `claude --print` does what we assume. Specifically:
- `claude -p "$(cat <handoff>)"` returns when the session finishes? Or does it stream until the tool calls drain? Check via local invocation against a tiny kickoff doc.
- Tool-use confirmation prompts in headless mode: are they auto-allowed via a flag (`--allowed-tools` or similar) or do they hang the run? This is the make-or-break question. Anthropic's docs as of 2026-01 named the flag `--allowedTools` (camelCase) — verify against `claude --help` in the runner.
- `AskUserQuestion` from inside the headless session: does it throw, hang, or emit a structured "needs input" signal? Plan for "hang" as the worst case and gate via a timeout.

Document findings in `docs/findings/headless-claude.md`. If `--print` doesn't support what the spec assumes, the orchestrator pivots to a different shape (e.g., capturing the kickoff prompt + opening an issue with `gh issue create` for a human to start the session) — surface to Roman before pivoting.

### 2. Wire the headless invocation in `src/commands/run.ts`

Replace the Day 1 hard-stop with:
1. Read the kickoff doc bytes (`fs.readFile`).
2. Ensure `<repo>/.session-orchestrator/` exists.
3. Write the marker file BEFORE invoking claude (pre-fire — per Q4 above; revise if Roman picks on-success).
4. `execa('claude', ['-p', '--allowedTools', '...', ...], { cwd: repoRoot, stdin: handoffContent, timeout: <env-tuned> })`.
5. Persist stdout/stderr to `<repo>/.session-orchestrator/runs/phase-N-<iso-timestamp>.log`.
6. On non-zero exit: write `phase-N.failed` marker, propagate the exit code.

Add a new module `src/lib/headless-claude.ts` for the execa wrapper so the command stays thin. Unit-test with mocked execa (use `vi.mock`).

### 3. Reusable GitHub Actions workflow at `.github/workflows/run-next-phase.yml`

Shape:
```yaml
name: Run next phase
on:
  workflow_call:
    secrets:
      ANTHROPIC_API_KEY: { required: true }
      LINEAR_API_KEY:    { required: false }
      SLACK_WEBHOOK_URL: { required: false }
permissions:
  contents: write       # for marker commits
  pull-requests: write  # for digest comment + session-opened PR linking
  issues: write         # for tracking-issue digest comment
jobs:
  next:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha-pinned>
      - uses: actions/setup-node@<sha-pinned>
        with: { node-version: 22 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: npx --package=session-orchestrator session-orchestrator next
      - run: npx --package=session-orchestrator session-orchestrator run --phase ${{ outputs.next.phase }}
      # ... digest comment step
```

**Security guardrails (per the brief's Working Principle A — don't cut corners on auth):**
- Pin every `uses:` by SHA, not by tag.
- `permissions:` block scoped per job.
- Never log `ANTHROPIC_API_KEY` — set it as a runner-level env var, never echo.
- Sanitize any user-controlled input (PR titles, branch names) before passing through to the headless session — treat as untrusted (prompt-injection risk).

### 4. Consumer workflow template at `examples/consumer.github-workflows.orchestrator.yml`

A documented copy-paste workflow consumers add to THEIR repo at `.github/workflows/orchestrator.yml`. Triggers: `pull_request: closed` on the configured feature branch + a daily `schedule:` cron. Calls the reusable workflow above with `uses: rsm0508/session-orchestrator/.github/workflows/run-next-phase.yml@<tag>`.

### 5. Test against a sandbox consumer repo (NOT ai-viz yet)

Per the brief: "Test in a sandbox repo (NOT ai-viz yet) with a mock kickoff doc." Stand up a tiny test repo on GitHub (private, single dummy kickoff doc that asks Claude to add a one-line comment to a file and open a PR). Wire the orchestrator workflow at it. Confirm:
- Workflow triggers on `pull_request: closed`.
- `next` resolves correctly.
- `run --phase 1` (no `--dry-run`) fires the session.
- Session opens a PR.
- Digest comment lands on the configured tracking issue.

Only after green sandbox should Day 3 wire ai-viz as a real consumer.

### 6. CI green

- `npx tsc --noEmit` clean.
- `npm test` green (new headless-claude unit tests with execa mocked).
- `npm run lint` clean (prettier check).
- The new GHA workflow itself passes a YAML lint pass — `actionlint` is a reasonable choice; not load-bearing for Day 2 to add.

## Doc-sync upfront

- Update `README.md`: replace "Status: Day 1 scope shipped" line; flesh out the "Install" + "How it works" sections with the actual headless flow.
- Add a `docs/headless-claude.md` page documenting Q1–Q5 answers + any quirks discovered in step 1.

## What this phase does NOT do

- Slack webhook integration — that's Day 3.
- Multi-runner parallelism — explicitly out of v1.0 (per brief).
- Cost reporting per run — out of v1.0.
- ai-viz as a real consumer — out of Day 2 (sandbox first).

## Acceptance for Day 2

- `claude --print` mode verified to support tool-use in headless context (or pivot documented).
- `src/commands/run.ts` fires the session in non-dry-run mode (no more "Day 2 scope" hard-stop).
- Reusable workflow at `.github/workflows/run-next-phase.yml` exists and passes a smoke run on a sandbox consumer.
- Tracking-issue digest comment lands on the sandbox.
- All 27 (+ new) unit tests green.
- `dist/` rebuilds clean.

## Working Principles citations

- **A (correct long-term fix):** the headless invocation is the load-bearing primitive — don't shortcut auth, error handling, or marker durability. Pre-fire markers + explicit `.failed` markers is more code than a single timestamp file, but it's the correct shape.
- **C (product decisions surface to Roman):** five questions above, batch them via `AskUserQuestion` BEFORE writing the workflow YAML.
- **E (new patterns):** the headless Claude CLI is the new primitive — verify `--print` + tool-use behavior with a tiny local smoke test before committing to the design.
- **F (pre-existing failures):** the `npm audit` output flagged 5 moderate-severity transitive vulns on Day 1. Investigate; if they're fixable without breaking, fix in this PR.

## Commit footer

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Phase memory write (mandatory at close)

Per Roman's auto-memory conventions: at Day 2 close, write
`~/.claude/projects/C--Users-roman-Documents-----FS-Projects-session-orchestrator/memory/project_day_2.md`
covering what shipped, banked traps, status of `--print` verification, and what Day 3 inherits. Add a one-line entry to `MEMORY.md`.

## Begin once

- Roman has resolved the 5 open product questions above via `AskUserQuestion`.
- The repo is on GitHub (Roman creates the private repo; this session can push).
- `gh auth status` reports authenticated.
