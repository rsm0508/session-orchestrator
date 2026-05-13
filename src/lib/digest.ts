import type { Config } from './config.js';
import type { FireResult } from './headless-claude.js';

export interface DigestInput {
  result: FireResult;
  config: Config;
  phase: number;
  /**
   * Optional GitHub Actions runner URL. Set in CI via:
   * `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`.
   * Omitted gracefully in local CLI runs.
   */
  runUrl?: string;
}

const SESSION_TAIL_BUDGET = 4000;

function fmtCost(usd: number | undefined): string {
  if (typeof usd !== 'number') return 'unknown';
  return `$${usd.toFixed(4)}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function clip(s: string, budget: number): { body: string; clipped: boolean } {
  if (s.length <= budget) return { body: s, clipped: false };
  return { body: s.slice(0, budget), clipped: true };
}

export function renderDigest(input: DigestInput): string {
  const { result, config, phase, runUrl } = input;
  const isSuccess = result.kind === 'success';
  const title = isSuccess
    ? `session-orchestrator phase ${phase} — success`
    : `session-orchestrator phase ${phase} — FAILED (reason=${result.reason}, exit=${result.exitCode})`;

  const rows: Array<[string, string]> = [
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
  } else {
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

  if (runUrl) rows.push(['run', runUrl]);

  const table = [
    '| metric | value |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${escapeCell(v)} |`),
  ].join('\n');

  const sessionResultRaw =
    result.kind === 'success'
      ? (result.envelope.result ?? '(no result text)')
      : (result.envelope?.result ?? '(no envelope result text)');
  const { body: sessionResult, clipped } = clip(sessionResultRaw, SESSION_TAIL_BUDGET);
  const sessionBlock =
    '<details><summary>session result</summary>\n\n' +
    '```\n' +
    sessionResult +
    (clipped ? `\n\n…(clipped; full text in ${result.logPath})` : '') +
    '\n```\n\n' +
    '</details>';

  let retryBlock = '';
  if (!isSuccess) {
    const f = result as Extract<FireResult, { kind: 'failure' }>;
    retryBlock =
      '\n\n**To retry:** delete `' +
      relMarker(f.startedMarkerPath, config) +
      '` AND `' +
      relMarker(f.failedMarkerPath, config) +
      '` on the default branch, then push (or wait for the next scheduled run).\n' +
      '**To roll back without retrying:** delete just the `.started` marker.\n';
  }

  return [`## ${title}`, '', table, '', sessionBlock, retryBlock].join('\n');
}

function escapeCell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function relMarker(absPath: string, _config: Config): string {
  // best-effort: surface the .session-orchestrator/... fragment, which is what
  // the operator types when deleting. We don't strictly know the repo root here,
  // so split on the well-known sentinel.
  const sentinel = '.session-orchestrator';
  const idx = absPath.indexOf(sentinel);
  return idx >= 0 ? absPath.slice(idx) : absPath;
}
