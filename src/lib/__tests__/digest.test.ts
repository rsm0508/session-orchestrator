import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { chooseFence, renderDigest } from '../digest.js';
import type { FireResult } from '../headless-claude.js';

const config: Config = {
  project_name: 'MCP v1.0',
  feature_branch: 'feat/mcp-v1',
  handoff_pattern: 'docs/handoffs/mcp-phase-{N}-kickoff.md',
  max_phase: 4,
  tracking_issue: 42,
  claude_model: 'claude-opus-4-7',
  allowed_tools: 'Read Write Edit Bash',
  max_budget_usd: 5.0,
};

describe('renderDigest', () => {
  it('renders a success digest with envelope metrics + session result block', () => {
    const result: FireResult = {
      kind: 'success',
      exitCode: 0,
      durationMs: 12_345,
      envelope: {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 3,
        total_cost_usd: 0.04,
        session_id: 's-abc',
        result: 'Opened PR #99 with the requested change.',
      },
      logPath: '/repo/.session-orchestrator/runs/phase-1-2026-05-12.log',
      startedMarkerPath: '/repo/.session-orchestrator/phase-1.started',
    };
    const md = renderDigest({ result, config, phase: 1, runUrl: 'https://example/run/1' });
    expect(md).toContain('## session-orchestrator phase 1 — success');
    expect(md).toContain('| phase | 1 |');
    expect(md).toContain('| project | MCP v1.0 |');
    expect(md).toContain('| turns | 3 |');
    expect(md).toContain('| cost | $0.0400 |');
    expect(md).toContain('| duration | 12.3s |');
    expect(md).toContain('| run | https://example/run/1 |');
    expect(md).toContain('<details><summary>session result</summary>');
    expect(md).toContain('Opened PR #99');
  });

  it('renders a failure digest with retry instructions and envelope errors', () => {
    const result: FireResult = {
      kind: 'failure',
      reason: 'non-zero-exit',
      exitCode: 1,
      durationMs: 8_000,
      envelope: {
        type: 'result',
        subtype: 'error_max_budget_usd',
        is_error: true,
        total_cost_usd: 5.12,
        errors: ['Reached maximum budget ($5)'],
        result: 'Budget exhausted before tool sequence completed.',
      },
      logPath: '/repo/.session-orchestrator/runs/phase-2-2026-05-12.log',
      startedMarkerPath: '/repo/.session-orchestrator/phase-2.started',
      failedMarkerPath: '/repo/.session-orchestrator/phase-2.failed',
    };
    const md = renderDigest({ result, config, phase: 2 });
    expect(md).toContain('## session-orchestrator phase 2 — FAILED (reason=non-zero-exit, exit=1)');
    expect(md).toContain('| reason | non-zero-exit |');
    expect(md).toContain('| envelope.subtype | error_max_budget_usd |');
    expect(md).toContain('| envelope.is_error | true |');
    expect(md).toContain('| envelope.errors | Reached maximum budget ($5) |');
    expect(md).toContain('| cost | $5.1200 |');
    expect(md).toContain('**To retry:**');
    expect(md).toContain('.session-orchestrator/phase-2.started');
    expect(md).toContain('.session-orchestrator/phase-2.failed');
  });

  it('handles spawn-failure with spawn_error row and no envelope', () => {
    const result: FireResult = {
      kind: 'failure',
      reason: 'spawn-failure',
      exitCode: -1,
      durationMs: 5,
      spawnError: 'ENOENT: spawn claude ENOENT',
      logPath: '/x/.session-orchestrator/runs/phase-1-2026.log',
      startedMarkerPath: '/x/.session-orchestrator/phase-1.started',
      failedMarkerPath: '/x/.session-orchestrator/phase-1.failed',
    };
    const md = renderDigest({ result, config, phase: 1 });
    expect(md).toContain('FAILED (reason=spawn-failure, exit=-1)');
    expect(md).toContain('| spawn_error | ENOENT: spawn claude ENOENT |');
    expect(md).not.toContain('| envelope.subtype |');
  });

  it('handles envelope-error with envelopeParseError', () => {
    const result: FireResult = {
      kind: 'failure',
      reason: 'envelope-error',
      exitCode: 0,
      durationMs: 100,
      envelopeParseError: 'JSON.parse failed: Unexpected token',
      logPath: '/x/.session-orchestrator/runs/phase-1-2026.log',
      startedMarkerPath: '/x/.session-orchestrator/phase-1.started',
      failedMarkerPath: '/x/.session-orchestrator/phase-1.failed',
    };
    const md = renderDigest({ result, config, phase: 1 });
    expect(md).toContain('| envelope_parse_error | JSON.parse failed: Unexpected token |');
  });

  it('escapes session results containing markdown code fences (P3 — Codex R2)', () => {
    // Coding-session results commonly include triple-backtick code blocks.
    // The digest's wrapping fence must be longer than any internal run, else
    // the embedded ``` closes the digest's fence early and the rest of the
    // comment renders broken.
    const resultWithCodeBlock = 'Opened PR with:\n```js\nconst x = 1;\n```\nLooks good.';
    const result: FireResult = {
      kind: 'success',
      exitCode: 0,
      durationMs: 100,
      envelope: { type: 'result', is_error: false, result: resultWithCodeBlock },
      logPath: '/x/.session-orchestrator/runs/phase-1-2026.log',
      startedMarkerPath: '/x/.session-orchestrator/phase-1.started',
    };
    const md = renderDigest({ result, config, phase: 1 });
    expect(md).toContain('````\n' + resultWithCodeBlock); // 4-backtick fence
    expect(md).toContain(resultWithCodeBlock + '\n````\n'); // matching close
  });

  it('chooseFence picks 3 backticks for plain text, longer for embedded fences', () => {
    expect(chooseFence('plain text')).toBe('```');
    expect(chooseFence('some `inline` code')).toBe('```');
    expect(chooseFence('embedded ``` triple')).toBe('````');
    expect(chooseFence('nested ```` quad')).toBe('`````');
    expect(chooseFence('mix `one` ``two`` ```three```')).toBe('````');
  });

  it('clips very long session result text and points to the log', () => {
    const huge = 'x'.repeat(10_000);
    const result: FireResult = {
      kind: 'success',
      exitCode: 0,
      durationMs: 200,
      envelope: { type: 'result', is_error: false, result: huge },
      logPath: '/x/.session-orchestrator/runs/phase-1-2026.log',
      startedMarkerPath: '/x/.session-orchestrator/phase-1.started',
    };
    const md = renderDigest({ result, config, phase: 1 });
    expect(md).toContain('(clipped; full text in /x/.session-orchestrator/runs/phase-1-2026.log)');
  });
});
