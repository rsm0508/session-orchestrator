# CLAUDE.md — session-orchestrator

## Project overview

Autonomous session-orchestration layer that fires fresh Claude Code sessions to advance multi-phase projects between phases. Node 22+ CLI (`session-orchestrator`) + a reusable GitHub Actions workflow. MIT, git-installable via the `prepare` script.

The orchestrator is plumbing — it scans the consumer repo for the next ready phase, checks kill switches, and invokes `claude -p --bare ...` headlessly with the kickoff doc piped to stdin. The session itself does the actual work (commits, PRs, ticket updates). The orchestrator never edits the consumer's code.

**First consumer:** ai-viz, once Day 3 ships. Use sandbox repos for verification before pointing at ai-viz.

## Working principles

Universal rules that override default behavior. If any other instruction conflicts with these, follow these.

**A. When in doubt, do the correct long-term fix.** When there's a choice between an expedient shortcut and the correct-but-slightly-bigger implementation, pick the correct one. The incremental cost of doing it right is almost always less than the compound cost of doing it wrong. This does **not** override YAGNI ("don't add features/abstractions beyond what the task requires") — YAGNI is about not expanding scope; this rule is about not cutting corners within scope.

**B. Codex reviews my code, never me.** When a task calls for evaluating code I wrote — `/review` skill, PR self-assessment, pre-merge sanity pass, "what decisions did I make" inventory — delegate to the local `codex` CLI first and respond to its findings. My role is implementer and judge-of-review-output, never reviewer of my own code. Quick sanity reads (did it compile? does this test cover my change?) stay mine; the line is "evaluate the quality of the work" → Codex. **Don't reach for `/ultrareview`** — that's a different (Anthropic, cloud, billed) system. The canonical local path is `codex review`.

**C. Product decisions surface to Roman; implementation decisions are mine.** If a change affects the consumer-facing config schema, the workflow's secret surface, the headless-invocation shape, marker semantics, or anything an operator types/touches — it's a product call and I ask via `AskUserQuestion` before deciding. If it only affects internals (library choice, code structure, naming within a module) — I can pick. When the line is fuzzy, ask.

**D. Don't defer correctness by tagging it "Day N".** TODO comments saying "Day 3 follow-up" rot. If a fix is deferred, it goes into the day-N kickoff doc or a tracking issue with a link back to the code location. If it's too small for that, either fix it now or don't mention it.

**E. New patterns require a codebase existence-check.** Before introducing a primitive (concurrency mechanism, marker convention, env-var name, exit-code value) that isn't already in this codebase — grep for it. If it's novel, that's a design decision worth surfacing, not adopting silently.

**F. Pre-existing failures aren't "someone else's problem".** If I encounter pre-existing test failures, build warnings, typecheck errors, or `npm audit` findings on the branch I'm working on, note them and propose a plan: fix, quarantine, or escalate. Don't ship a session that says "3 vulns flagged but they were here before I got here" unless Roman has explicitly approved that framing.

## Codex review protocol (Working Principle B → operational)

This project inherits the protocol from ai-viz. **Read** `C:\Users\roman\Documents\____FS\Projects\ai-viz\.claude\commands\codex-review.md` for the canonical version. Adapted for session-orchestrator:

**CLI shape (Windows, foreground only):**

```bash
RAW=".codex-review-$(date +%s).raw"
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=safe.directory \
GIT_CONFIG_VALUE_0="C:/Users/roman/Documents/____FS/Projects/session-orchestrator" \
  codex review --base <merge-base-sha> --title "<short-title>" 2>&1 | tee "$RAW"
```

**Hard rules:**

- **3-round cap per artifact.** After round 3, any remaining findings become a real tracking-doc TODO (e.g., in the next day's kickoff handoff), not another round.
- **Never `run_in_background: true`** on Windows — codex bails on no-TTY, producing 0-byte output. Foreground only, with `| tee`.
- **`~/.codex/config.toml`** must have `model_reasoning_effort = "medium"` (or higher) + `model_reasoning_summary = "auto"` at the top.
- **`--base`/`--commit`/`--uncommitted`** are mutually exclusive with positional `[PROMPT]`. Use the built-in review instructions.
- Saved findings go to `docs/code-review/branch-<name>.md` (or `pr-<n>.md`). Triage inline with `[ACCEPTED]` / `[SKIPPED — <reason>]`.

When in doubt about the protocol, the ai-viz skill file is authoritative — defer to it.

## Architecture

- `src/commands/` — oclif command implementations (one file per command). Commands stay thin; orchestration logic lives in `src/lib/`.
- `src/lib/config.ts` — zod-strict YAML schema. Required fields: `project_name`, `feature_branch`, `handoff_pattern` (must contain `{N}`), `max_phase`, `tracking_issue`, `allowed_tools`, `max_budget_usd`. Optional: `linear_team`, `claude_model` (default `claude-opus-4-7`).
- `src/lib/phase-resolver.ts` — phase scan + readiness rule. A phase is ready iff `handoff && !started && !failed` AND no earlier phase has `.failed`. **One failed phase blocks the whole orchestrator globally** — see README's "How next phase ready is decided" section for the operator-facing semantics.
- `src/lib/kill-switch.ts` — 3 independent paths (file / env / Linear-label seam). All checked in parallel; any single active source halts a run. The full source list is returned (not first-hit) so the digest comment can tell the operator exactly what to flip.
- `src/lib/headless-claude.ts` — the execa wrapper. Pre-fires `.started` marker atomically (exclusive create — duplicate-fire guard), spawns `claude -p --bare ...`, captures stdout/stderr to a log, parses the JSON envelope, writes `.failed` on any failure path, persists `*.result.json` + `*.digest.md` alongside the log for the GHA workflow to consume.
- `src/lib/digest.ts` — pure `FireResult → markdown` renderer for the tracking-issue digest comment.

**Marker convention** (`.session-orchestrator/`):

| File                             | Written by                | Meaning                                                                          |
| -------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `phase-N.started`                | wrapper (pre-fire)        | Session was kicked off. Authoritative duplicate guard via `flag: 'wx'` on write. |
| `phase-N.failed`                 | wrapper (on failure)      | Session failed (any reason). Blocks orchestrator globally until cleared.         |
| `runs/phase-N-<iso>.log`         | wrapper                   | Full stdout + stderr of the fire (gitignored — runner-only).                     |
| `runs/phase-N-<iso>.result.json` | wrapper                   | Structured FireResult JSON (envelope + paths + reason).                          |
| `runs/phase-N-<iso>.digest.md`   | wrapper (via `digest.ts`) | Pre-rendered markdown for the tracking-issue comment.                            |

## Locked product decisions

Decided via `AskUserQuestion` rounds — do not re-derive without explicit re-approval.

| Decision                  | Value                                                               | Round                            |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| Runtime                   | GitHub Actions only                                                 | Day 1                            |
| Repo name + visibility    | `rsm0508/session-orchestrator`, private initially                   | Day 1                            |
| Trigger model             | Event-driven (PR-merge) + daily schedule safety-net                 | Day 1                            |
| Phase-ready signal        | Handoff file + no `.started` AND no `.failed` markers               | Day 1 + revised Day 2 (Codex R1) |
| Kill switch               | File + env var + Linear label (all independent; any halts)          | Day 1                            |
| Headless invocation shape | stdin pipe (`cat <kickoff> \| claude -p ...`)                       | Day 2                            |
| Marker write timing       | Pre-fire `.started` (exclusive) + `.failed` on non-zero exit        | Day 2 + revised in Codex R1      |
| Digest comment shape      | Fixed template + fold-out session-result `<details>` block          | Day 2                            |
| CLI install in runner     | `npm install -g @anthropic-ai/claude-code`                          | Day 2                            |
| GHA runner OS             | `ubuntu-latest`                                                     | Day 2                            |
| `--bare` mode             | Always on (mandatory in CI; ~$0.11/fire saved vs full-context)      | Day 2 (verified)                 |
| `--permission-mode`       | `bypassPermissions` (clearer than `--dangerously-skip-permissions`) | Day 2 (verified)                 |
| `allowed_tools` config    | Required, no default. Refuses `AskUserQuestion`.                    | Day 2                            |
| `max_budget_usd` config   | Required, no default. Positive number.                              | Day 2                            |

## Operating rhythm (cross-project)

This section is **portable** — it's the same rhythm documented in ai-viz/CLAUDE.md's "Operating model" section. Three pillars compose:

1. **Auto-memory** at `~/.claude/projects/<project-key>/memory/`. Project-specific memory lives in `C--Users-roman-Documents-----FS-Projects-session-orchestrator/memory/`; cross-project rules (like the Codex rhythm) live in the parent `C--Users-roman-Documents-----FS-Projects/memory/`.
2. **Handoff docs** at `docs/handoffs/day-N-kickoff.md`. Every multi-day project gets one kickoff per day. The current one IS the rolling spec until v1.0 ships a stable `docs/spec.md`.
3. **MCP / subagents** (not yet wired here — session-orchestrator is a small project; revisit if it grows past v1.0).

## Handoff documentation conventions

Mostly inherited from ai-viz/CLAUDE.md's "Handoff documentation conventions" section. session-orchestrator-specific adaptations:

1.  **Resolve memory paths.** The project key for this repo is `C--Users-roman-Documents-----FS-Projects-session-orchestrator` (sanitized cwd). Use that literal path; don't write `<project-key>` or `...`.
2.  **Surface open product questions BEFORE coding** via `AskUserQuestion`. The kickoff doc must have a dedicated `## Open product questions — surface to Roman BEFORE coding` heading near the top.
3.  **Codex review is mandatory before merging Day N → main** for any non-trivial code change. See Codex review protocol above.
4.  **Phase memory write is mandatory at close.** Each day produces a `project_day_N.md` in this project's memory dir + a one-line entry in its `MEMORY.md`.
5.  **Commit footer.** Every commit Claude authors carries:

        Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

    No exceptions unless explicitly waived.

6.  **Cite Working Principles inline at decision points**, not just in the prerequisite reading list.
7.  **Verify clean working state at session start.** `git status` + `git stash list` + `git branch --show-current` + `git rev-parse HEAD`.

## Tone

- Match response length to the task. Trivial question → one sentence. Design decision → bullets + rationale.
- Don't narrate internal deliberation. State results and decisions directly.
- No emojis in code or commits unless Roman explicitly asks.
- Comments in source files are sparing; lead with WHY when not obvious from the identifier.

## Commit + PR rules

- Only commit when Roman explicitly asks.
- Use HEREDOCs for multi-line commit messages.
- Never `--no-verify`, never `--no-gpg-sign`, never amend a published commit.
- Don't push without explicit ask. Roman runs `git push` himself.
- The `Co-Authored-By` footer above is mandatory.
