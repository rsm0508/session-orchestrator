import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execa as defaultExeca } from 'execa';
import { renderDigest } from './digest.js';
import { MARKERS_DIR, failedMarkerRelativePath, startedMarkerRelativePath, } from './phase-resolver.js';
export const RUNS_SUBDIR = 'runs';
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const HEADLESS_TIMEOUT_ENV = 'SESSION_ORCHESTRATOR_TIMEOUT_MS';
export const CLAUDE_BIN_ENV = 'SESSION_ORCHESTRATOR_CLAUDE_BIN';
export function buildClaudeArgs(input) {
    const { config } = input;
    return [
        '-p',
        '--bare',
        '--input-format',
        'text',
        '--output-format',
        'json',
        '--permission-mode',
        'bypassPermissions',
        '--allowedTools',
        config.allowed_tools,
        '--no-session-persistence',
        '--max-budget-usd',
        String(config.max_budget_usd),
        '--model',
        config.claude_model,
    ];
}
function isoStampForLog(d) {
    return d.toISOString().replace(/[:.]/g, '-');
}
function resolveTimeout(opts) {
    if (typeof opts.timeoutMs === 'number')
        return opts.timeoutMs;
    const env = opts.env ?? process.env;
    const raw = env[HEADLESS_TIMEOUT_ENV];
    if (raw) {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    return DEFAULT_TIMEOUT_MS;
}
function resolveClaudeBin(opts) {
    const env = opts.env ?? process.env;
    return env[CLAUDE_BIN_ENV] || 'claude';
}
export function parseEnvelope(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed)
        return { error: 'empty stdout' };
    // --output-format json emits a single JSON object. Take the last non-empty line
    // so any stray pre-envelope chatter (warnings, progress) is ignored.
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1];
    if (!last)
        return { error: 'empty stdout' };
    try {
        const parsed = JSON.parse(last);
        if (parsed === null || typeof parsed !== 'object') {
            return { error: 'envelope was not a JSON object' };
        }
        return { envelope: parsed };
    }
    catch (err) {
        return { error: `envelope JSON.parse failed: ${err.message}` };
    }
}
async function tryWriteFile(p, body) {
    try {
        await fs.writeFile(p, body, 'utf8');
    }
    catch (err) {
        // Defense in depth: surface to stderr but don't crash the run-result return path.
        // A failure to write the .failed marker on a doomed run shouldn't escalate.
        // eslint-disable-next-line no-console
        console.error(`[headless-claude] failed to write ${p}: ${err.message}`);
    }
}
export async function fireHeadlessSession(opts) {
    const exec = opts.execaFn ?? defaultExeca;
    const now = opts.now ?? (() => new Date());
    const env = opts.env ?? process.env;
    const startedAt = now();
    const t0 = startedAt.getTime();
    const startedRel = startedMarkerRelativePath(opts.phase);
    const failedRel = failedMarkerRelativePath(opts.phase);
    const startedMarkerPath = path.join(opts.repoRoot, startedRel);
    const failedMarkerPath = path.join(opts.repoRoot, failedRel);
    const markersDir = path.join(opts.repoRoot, MARKERS_DIR);
    const runsDir = path.join(markersDir, RUNS_SUBDIR);
    const stamp = opts.logTimestamp ?? isoStampForLog(startedAt);
    const logPath = path.join(runsDir, `phase-${opts.phase}-${stamp}.log`);
    const resultJsonPath = path.join(runsDir, `phase-${opts.phase}-${stamp}.result.json`);
    const digestPath = path.join(runsDir, `phase-${opts.phase}-${stamp}.digest.md`);
    await fs.mkdir(runsDir, { recursive: true });
    // Authoritative duplicate-fire guard: exclusive-create the .started marker.
    // The pre-check in run.ts catches the common case early for UX, but two
    // concurrent triggers (PR-merge + cron in the same minute) can both pass that
    // check before either writes. `flag: 'wx'` makes the marker write atomic — the
    // second writer hits EEXIST and we bow out without spawning a duplicate session.
    try {
        await fs.writeFile(startedMarkerPath, `started phase ${opts.phase} at ${startedAt.toISOString()}\nrun log: ${logPath}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    catch (err) {
        if (err.code === 'EEXIST') {
            const collisionAt = now();
            return {
                kind: 'failure',
                reason: 'marker-collision',
                exitCode: -1,
                durationMs: collisionAt.getTime() - t0,
                logPath,
                startedMarkerPath,
                failedMarkerPath,
                spawnError: `EEXIST: marker already present at ${startedMarkerPath} — another fire is in flight (or a stale marker needs cleanup)`,
            };
        }
        throw err;
    }
    const args = buildClaudeArgs({ config: opts.config });
    const bin = resolveClaudeBin(opts);
    const timeoutMs = resolveTimeout(opts);
    let stdout = '';
    let stderr = '';
    let exitCode = -1;
    let spawnError;
    let timedOut = false;
    try {
        const result = await exec(bin, args, {
            cwd: opts.repoRoot,
            input: opts.kickoffContent,
            timeout: timeoutMs,
            env,
            reject: false,
            all: false,
        });
        stdout = String(result.stdout ?? '');
        stderr = String(result.stderr ?? '');
        exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1;
        timedOut = Boolean(result.timedOut);
    }
    catch (err) {
        const e = err;
        stdout = typeof e.stdout === 'string' ? e.stdout : '';
        stderr = typeof e.stderr === 'string' ? e.stderr : '';
        spawnError = `${e.code ?? 'ERR'}: ${e.message}`;
    }
    const finishedAt = now();
    const durationMs = finishedAt.getTime() - t0;
    const logBody = `# session-orchestrator phase ${opts.phase} run log\n` +
        `started: ${startedAt.toISOString()}\n` +
        `finished: ${finishedAt.toISOString()}\n` +
        `duration_ms: ${durationMs}\n` +
        `exit_code: ${exitCode}\n` +
        `timed_out: ${timedOut}\n` +
        (spawnError ? `spawn_error: ${spawnError}\n` : '') +
        `command: ${bin} ${args.join(' ')}\n` +
        `\n--- stdout ---\n${stdout}\n` +
        `\n--- stderr ---\n${stderr}\n`;
    await tryWriteFile(logPath, logBody);
    const finalize = async (r) => {
        await tryWriteFile(resultJsonPath, JSON.stringify(r, null, 2));
        const runUrl = (opts.env ?? process.env).GITHUB_RUN_URL || undefined;
        await tryWriteFile(digestPath, renderDigest({ result: r, config: opts.config, phase: opts.phase, runUrl }));
        return r;
    };
    if (spawnError) {
        await tryWriteFile(failedMarkerPath, `phase ${opts.phase} spawn failure at ${finishedAt.toISOString()}\n` +
            `${spawnError}\nlog: ${logPath}\n`);
        return finalize({
            kind: 'failure',
            reason: 'spawn-failure',
            exitCode,
            durationMs,
            spawnError,
            logPath,
            startedMarkerPath,
            failedMarkerPath,
        });
    }
    if (timedOut) {
        await tryWriteFile(failedMarkerPath, `phase ${opts.phase} timed out at ${finishedAt.toISOString()} ` +
            `after ${timeoutMs}ms\nlog: ${logPath}\n`);
        return finalize({
            kind: 'failure',
            reason: 'timeout',
            exitCode,
            durationMs,
            logPath,
            startedMarkerPath,
            failedMarkerPath,
        });
    }
    const { envelope, error: envelopeParseError } = parseEnvelope(stdout);
    if (exitCode !== 0) {
        await tryWriteFile(failedMarkerPath, `phase ${opts.phase} exited ${exitCode} at ${finishedAt.toISOString()}\n` +
            `envelope_subtype: ${envelope?.subtype ?? '(unparseable)'}\nlog: ${logPath}\n`);
        return finalize({
            kind: 'failure',
            reason: 'non-zero-exit',
            exitCode,
            durationMs,
            envelope,
            envelopeParseError,
            logPath,
            startedMarkerPath,
            failedMarkerPath,
        });
    }
    if (!envelope) {
        await tryWriteFile(failedMarkerPath, `phase ${opts.phase} succeeded on exit but envelope unparseable: ${envelopeParseError}\nlog: ${logPath}\n`);
        return finalize({
            kind: 'failure',
            reason: 'envelope-error',
            exitCode,
            durationMs,
            envelopeParseError,
            logPath,
            startedMarkerPath,
            failedMarkerPath,
        });
    }
    if (envelope.is_error === true) {
        await tryWriteFile(failedMarkerPath, `phase ${opts.phase} envelope is_error=true at ${finishedAt.toISOString()}\n` +
            `subtype: ${envelope.subtype ?? '(unknown)'}\n` +
            `result: ${envelope.result ?? '(none)'}\nlog: ${logPath}\n`);
        return finalize({
            kind: 'failure',
            reason: 'envelope-error',
            exitCode,
            durationMs,
            envelope,
            logPath,
            startedMarkerPath,
            failedMarkerPath,
        });
    }
    return finalize({
        kind: 'success',
        exitCode: 0,
        durationMs,
        envelope,
        logPath,
        startedMarkerPath,
    });
}
//# sourceMappingURL=headless-claude.js.map