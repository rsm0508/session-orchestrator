const SESSION_TAIL_BUDGET = 4000;
function fmtCost(usd) {
    if (typeof usd !== 'number')
        return 'unknown';
    return `$${usd.toFixed(4)}`;
}
function fmtDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
function clip(s, budget) {
    if (s.length <= budget)
        return { body: s, clipped: false };
    return { body: s.slice(0, budget), clipped: true };
}
/**
 * Pick a fence longer than any backtick run inside `text` so embedded code
 * blocks (common in coding-session results) don't close the digest's fence
 * early. GitHub-flavored markdown allows any N≥3 backticks as a fence; the
 * closing fence must match.
 */
export function chooseFence(text) {
    let longest = 0;
    const runs = text.match(/`+/g);
    if (runs)
        for (const r of runs)
            longest = Math.max(longest, r.length);
    return '`'.repeat(Math.max(3, longest + 1));
}
export function renderDigest(input) {
    const { result, config, phase, runUrl } = input;
    const isSuccess = result.kind === 'success';
    const title = isSuccess
        ? `session-orchestrator phase ${phase} — success`
        : `session-orchestrator phase ${phase} — FAILED (reason=${result.reason}, exit=${result.exitCode})`;
    const rows = [
        ['phase', String(phase)],
        ['project', config.project_name],
        ['feature_branch', config.feature_branch],
        ['model', config.claude_model],
        ['exit', String(result.exitCode)],
        ['duration', fmtDuration(result.durationMs)],
    ];
    if (result.kind === 'success') {
        rows.push(['turns', String(result.envelope.num_turns ?? '?')]);
        rows.push(['cost', fmtCost(result.envelope.total_cost_usd)]);
        rows.push(['envelope.subtype', result.envelope.subtype ?? '(none)']);
        if (result.envelope.session_id) {
            rows.push(['session_id', result.envelope.session_id]);
        }
    }
    else {
        rows.push(['reason', result.reason]);
        if (result.envelope) {
            rows.push(['envelope.subtype', result.envelope.subtype ?? '(none)']);
            rows.push(['envelope.is_error', String(result.envelope.is_error)]);
            if (typeof result.envelope.total_cost_usd === 'number') {
                rows.push(['cost', fmtCost(result.envelope.total_cost_usd)]);
            }
            if (result.envelope.errors?.length) {
                rows.push(['envelope.errors', result.envelope.errors.join('; ')]);
            }
        }
        if (result.envelopeParseError) {
            rows.push(['envelope_parse_error', result.envelopeParseError]);
        }
        if (result.spawnError) {
            rows.push(['spawn_error', result.spawnError]);
        }
    }
    if (runUrl)
        rows.push(['run', runUrl]);
    const table = [
        '| metric | value |',
        '|---|---|',
        ...rows.map(([k, v]) => `| ${k} | ${escapeCell(v)} |`),
    ].join('\n');
    const sessionResultRaw = result.kind === 'success'
        ? (result.envelope.result ?? '(no result text)')
        : (result.envelope?.result ?? '(no envelope result text)');
    const { body: sessionResult, clipped } = clip(sessionResultRaw, SESSION_TAIL_BUDGET);
    const fence = chooseFence(sessionResult);
    const sessionBlock = '<details><summary>session result</summary>\n\n' +
        fence +
        '\n' +
        sessionResult +
        (clipped ? `\n\n…(clipped; full text in ${result.logPath})` : '') +
        '\n' +
        fence +
        '\n\n' +
        '</details>';
    let retryBlock = '';
    if (!isSuccess) {
        const f = result;
        if (f.reason === 'marker-collision') {
            // No retry semantics: the prior fire owns the markers + digest.
            retryBlock =
                '\n\n**Note:** Another fire is in flight (or a stale `.started` marker remains). ' +
                    'No `.failed` marker was written by this run — the in-flight fire will post its own digest when it finishes. ' +
                    'If the prior fire crashed and the marker is stale, delete `' +
                    relMarker(f.startedMarkerPath, config) +
                    '` on the default branch and retry.\n';
        }
        else {
            // `.failed` blocks readiness (see resolveNextPhase). Both markers must be
            // deleted to retry. Operator can also mark the phase as "done despite the
            // failure" by deleting only `.failed`, keeping `.started` as audit trail.
            retryBlock =
                '\n\n**To retry:** delete BOTH `' +
                    relMarker(f.startedMarkerPath, config) +
                    '` AND `' +
                    relMarker(f.failedMarkerPath, config) +
                    '` on the default branch, then push (or wait for the next scheduled run).\n' +
                    '**To mark phase done without retrying** (treat the failure as acceptable, advance to next phase): ' +
                    'delete just `' +
                    relMarker(f.failedMarkerPath, config) +
                    '` — `.started` stays as audit trail.\n';
        }
    }
    return [`## ${title}`, '', table, '', sessionBlock, retryBlock].join('\n');
}
function escapeCell(v) {
    return v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function relMarker(absPath, _config) {
    // best-effort: surface the .session-orchestrator/... fragment, which is what
    // the operator types when deleting. We don't strictly know the repo root here,
    // so split on the well-known sentinel.
    const sentinel = '.session-orchestrator';
    const idx = absPath.indexOf(sentinel);
    return idx >= 0 ? absPath.slice(idx) : absPath;
}
//# sourceMappingURL=digest.js.map