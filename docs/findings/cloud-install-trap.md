# Findings — `npm install -g <git-url>` is silently broken on npm 10.x

**Date:** 2026-05-13
**npm version under test:** 10.9.7 (bundled with Node 22.x — both Ubuntu runner and `node:22` Docker image)
**Trigger:** Day-2 sandbox-smoke Scenario 2 — first real cloud fire on `rsm0508/orchestrator-sandbox` failed at `session-orchestrator --version` with `command not found` despite `npm install -g` exiting 0.

## TL;DR

`npm install -g github:<owner>/<repo>#<ref>` (and the equivalent `git+https://...` form) on npm 10.x leaves the global `bin/` symlink pointing into a temporary clone directory that npm cleans up before exit. The package is never actually extracted into `~/.npm-global/lib/node_modules/`. Result: install reports success, every subsequent `<bin-name>` invocation prints "command not found" or "No such file or directory".

**The workaround:** clone the ref manually, `npm pack`, then `npm install -g <tarball>`. Same internal flow npm intends, but bypasses the broken git-URL handoff.

This bit us four ways in flight. The wrapper-level fix landed in `8753b48`; before it, three separate symptoms ("missing dist", "exec bit", "PATH issue") obscured the actual root cause.

## Symptoms

In CI logs, all of these surfaced simultaneously and pointed at unrelated diagnoses:

1. `session-orchestrator: command not found` immediately after `npm install -g ...` returned exit 0.
2. `npm root -g` showed the package directory listed — but `ls -la $(npm root -g)/session-orchestrator` revealed a broken symlink (`No such file or directory` on traversal).
3. `find` against the symlink target showed the path lived under `/tmp/npm-tmp-<hash>/...` — a directory that no longer existed.
4. Re-running with `--verbose` showed `npm` logging `prepared` for a git-shorthand source, then cleanup of the same path before the bin link is materialized.

## Repro (local Docker)

The cleanest repro that matched the runner exactly:

```bash
docker run --rm -it node:22 bash
# inside container:
npm install -g github:rsm0508/session-orchestrator#main
ls -la "$(npm root -g)/session-orchestrator"
# lrwxrwxrwx ... session-orchestrator -> /tmp/npm-cacache-XXXX-xxxx/...
ls -la "$(npm root -g)/session-orchestrator/"
# ls: cannot access '...': No such file or directory
session-orchestrator --version
# bash: session-orchestrator: command not found
```

Same result with explicit `git+https://github.com/...#main` form. Same result with a published-from-private-repo tarball URL if the URL routes through npm's git path.

## What npm 10 actually does

From `npm install --verbose` traces:

1. Resolves `github:<owner>/<repo>#<ref>` → a `git://` style spec.
2. Clones the ref into a per-install temp dir under `/tmp/` (e.g. `/tmp/npm-cacache-NNN-XXXX/`).
3. Runs the package's `prepare` script in that temp clone (when present).
4. Symlinks the global package dir → the temp clone path.
5. Cleans up the temp dir.

Step 4 is the bug: the symlink is created **before** the package contents are copied to the persistent location, and step 5 nukes the target of the symlink. The package effectively never installs.

A historically valid path (npm < 10) was for the `prepare` script to run `tsc` (or equivalent), then npm would pack the resulting build artifacts and install from that tarball. On npm 10 the symlink path bypasses that flow.

## What we tried first (and why those weren't the fix)

| Diagnosis | Fix attempted | Why it didn't matter | Commit |
|---|---|---|---|
| `dist/` was gitignored — cloud install had no built JS, `prepare` script's `tsc` failed because devDeps weren't installed | Ship `dist/` in git; drop `prepare` script | Real prereq, but with `dist/` shipped the symlink trap still left `dist/` unreachable in `npm root -g` | `66a514f` |
| `bin/run.js` was mode `100644` in git → Linux exec failed | `git update-index --chmod=+x bin/run.js` | Genuinely needed for Linux execution but irrelevant when the bin isn't reachable at all | `2f0e288` |

Both fixes were correct on their own merits and were retained. Neither addressed the dangling symlink, which only became visible after we forced an `ls -la` on the npm-root path inside the runner.

## The fix (commit `8753b48`)

Install step in `.github/workflows/run-next-phase.yml` now does:

```bash
TMPDIR=$(mktemp -d)
SO_DIR="$TMPDIR/so"
mkdir "$SO_DIR"
cd "$SO_DIR"
git init -q -b main
git remote add origin https://github.com/rsm0508/session-orchestrator.git
git fetch --depth 1 origin "$ORCH_REF"
git checkout -q FETCH_HEAD
TARBALL=$(npm pack --silent)
npm install -g "$SO_DIR/$TARBALL"
```

Why `git init` + `git fetch` instead of `git clone --branch`:

- The `orchestrator-ref` input contract supports raw SHAs in addition to branch/tag names.
- `git clone --branch <ref>` rejects raw SHAs. `git fetch <ref>` accepts all three forms.

Why `npm pack` + tarball install:

- `npm pack` runs the same pre-publish flow npm would have invoked internally, but emits a real `.tgz` on disk.
- `npm install -g <tarball>` is npm's well-tested local-file install path — no git resolution, no temp clone, no cleanup race.

## Day-3+ followup

- **Switch to a published-tarball install** once we cut a versioned release on a registry (npm or GitHub Releases). That removes the git step entirely and gives consumers a content-addressable install URL.
- This finding informs the **"Codex review needs a live workflow run"** lesson in `docs/handoffs/day-3-kickoff.md` — three static codex rounds on the workflow never surfaced this trap because the symptom only appears under real `npm install -g` execution on a Linux runner with `/tmp` mounted as tmpfs.

## References

- npm RFC discussion on git-spec install behavior changes between npm 8 → 10: https://github.com/npm/cli/issues/4828 (related, not exact).
- Commits in this repo: `8753b48` (workflow install fix + `.codex-output/` gitignore); `66a514f` (ship dist/); `2f0e288` (bin/run.js exec bit).
