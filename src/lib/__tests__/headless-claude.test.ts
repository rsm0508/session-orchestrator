import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { execa as realExeca } from 'execa';
import type { Config } from '../config.js';
import {
  buildClaudeArgs,
  fireHeadlessSession,
  parseEnvelope,
  type FireOptions,
} from '../headless-claude.js';

const baseConfig: Config = {
  project_name: 'Headless Test',
  feature_branch: 'feat/h',
  handoff_pattern: 'docs/handoffs/h-phase-{N}.md',
  max_phase: 2,
  tracking_issue: 1,
  claude_model: 'claude-opus-4-7',
  allowed_tools: 'Read Write Edit Bash',
  max_budget_usd: 2.5,
};

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'so-hc-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

type MockExeca = ReturnType<typeof vi.fn>;

function makeOk(stdout: string, stderr = ''): MockExeca {
  return vi.fn().mockResolvedValue({
    stdout,
    stderr,
    exitCode: 0,
    failed: false,
    timedOut: false,
    signal: undefined,
    command: 'claude',
  });
}

function makeNonZeroExit(exitCode: number, stdout = '', stderr = ''): MockExeca {
  return vi.fn().mockResolvedValue({
    stdout,
    stderr,
    exitCode,
    failed: true,
    timedOut: false,
    signal: undefined,
    command: 'claude',
  });
}

function makeTimedOut(stdout = '', stderr = ''): MockExeca {
  return vi.fn().mockResolvedValue({
    stdout,
    stderr,
    exitCode: 124,
    failed: true,
    timedOut: true,
    signal: 'SIGTERM',
    command: 'claude',
  });
}

function makeThrow(code: string, message: string): MockExeca {
  return vi.fn().mockImplementation(async () => {
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    throw err;
  });
}

function baseOpts(extra: Partial<FireOptions>): FireOptions {
  return {
    repoRoot: tmpRoot,
    phase: 1,
    config: baseConfig,
    kickoffContent: '# kickoff body\nDo a thing.\n',
    logTimestamp: '2026-05-12T20-00-00-000Z',
    now: () => new Date('2026-05-12T20:00:00.000Z'),
    timeoutMs: 60_000,
    env: { ANTHROPIC_API_KEY: 'sk-test' },
    ...extra,
  };
}

describe('buildClaudeArgs', () => {
  it('produces the canonical headless flag sequence', () => {
    const args = buildClaudeArgs({ config: baseConfig });
    // Must include --bare, --output-format json, bypassPermissions, and
    // pass allowed_tools/max_budget_usd/model verbatim from config.
    expect(args).toEqual([
      '-p',
      '--bare',
      '--input-format',
      'text',
      '--output-format',
      'json',
      '--permission-mode',
      'bypassPermissions',
      '--allowedTools',
      'Read Write Edit Bash',
      '--no-session-persistence',
      '--max-budget-usd',
      '2.5',
      '--model',
      'claude-opus-4-7',
    ]);
  });
});

describe('parseEnvelope', () => {
  it('parses a single-line JSON envelope', () => {
    const r = parseEnvelope('{"type":"result","is_error":false}');
    expect(r.envelope).toEqual({ type: 'result', is_error: false });
    expect(r.error).toBeUndefined();
  });

  it('takes the last non-empty line when there is pre-envelope chatter', () => {
    const r = parseEnvelope(
      'some non-json warning line\n\n{"type":"result","subtype":"success","is_error":false}',
    );
    expect(r.envelope?.subtype).toBe('success');
  });

  it('returns an error for empty stdout', () => {
    expect(parseEnvelope('')).toMatchObject({ error: 'empty stdout' });
    expect(parseEnvelope('   \n  \n')).toMatchObject({ error: 'empty stdout' });
  });

  it('returns an error for malformed JSON', () => {
    const r = parseEnvelope('not json {{');
    expect(r.envelope).toBeUndefined();
    expect(r.error).toContain('envelope JSON.parse failed');
  });

  it('rejects a JSON primitive as envelope', () => {
    const r = parseEnvelope('"hello"');
    expect(r.envelope).toBeUndefined();
    expect(r.error).toContain('not a JSON object');
  });
});

describe('fireHeadlessSession — happy path', () => {
  it('writes .started marker, writes log, returns success on clean exit + is_error: false', async () => {
    const envelope = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1234,
      total_cost_usd: 0.04,
      num_turns: 3,
      session_id: 's-1',
      uuid: 'u-1',
      result: 'DONE',
    };
    const execa = makeOk(JSON.stringify(envelope));

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca }),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.exitCode).toBe(0);
    expect(result.envelope.result).toBe('DONE');
    expect(result.envelope.total_cost_usd).toBe(0.04);

    // .started marker exists, .failed does not
    await expect(fs.access(result.startedMarkerPath)).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpRoot, '.session-orchestrator', 'phase-1.failed')),
    ).rejects.toThrow();

    // log file written with stdout content
    const logBody = await fs.readFile(result.logPath, 'utf8');
    expect(logBody).toContain('DONE');
    expect(logBody).toContain('exit_code: 0');
    expect(logBody).toContain('--- stdout ---');
  });

  it('writes a structured result.json alongside the log (for digest consumption)', async () => {
    const envelope = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.02,
      result: 'OK',
    };
    const execa = makeOk(JSON.stringify(envelope));

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca }),
    );

    if (result.kind !== 'success') throw new Error('expected success');
    const resultJsonPath = result.logPath.replace(/\.log$/, '.result.json');
    const raw = await fs.readFile(resultJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe('success');
    expect(parsed.envelope.result).toBe('OK');
    expect(parsed.envelope.total_cost_usd).toBe(0.02);
  });

  it('passes the kickoff content via stdin (input: option)', async () => {
    const execa = makeOk('{"type":"result","is_error":false}');
    await fireHeadlessSession(
      baseOpts({
        execaFn: execa as unknown as typeof realExeca,
        kickoffContent: 'MARKER_KICKOFF_BODY',
      }),
    );
    const [, , options] = execa.mock.calls[0]!;
    expect(options.input).toBe('MARKER_KICKOFF_BODY');
    expect(options.cwd).toBe(tmpRoot);
    expect(options.reject).toBe(false);
    expect(options.timeout).toBe(60_000);
  });
});

describe('fireHeadlessSession — failure paths', () => {
  it('non-zero exit writes .failed marker and surfaces parseable envelope', async () => {
    const env = {
      type: 'result',
      subtype: 'error_max_budget_usd',
      is_error: true,
      total_cost_usd: 2.6,
      errors: ['Reached maximum budget ($2.5)'],
    };
    const execa = makeNonZeroExit(1, JSON.stringify(env));

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca }),
    );

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.reason).toBe('non-zero-exit');
    expect(result.exitCode).toBe(1);
    expect(result.envelope?.subtype).toBe('error_max_budget_usd');

    const failedBody = await fs.readFile(result.failedMarkerPath, 'utf8');
    expect(failedBody).toContain('exited 1');
    expect(failedBody).toContain('error_max_budget_usd');
  });

  it('clean exit + is_error: true (e.g. "Not logged in") classifies as envelope-error', async () => {
    const env = {
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      total_cost_usd: 0,
    };
    const execa = makeOk(JSON.stringify(env));

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca }),
    );

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.reason).toBe('envelope-error');
    expect(result.exitCode).toBe(0);
    expect(result.envelope?.result).toContain('Not logged in');
    await expect(fs.access(result.failedMarkerPath)).resolves.toBeUndefined();
  });

  it('unparseable envelope on clean exit classifies as envelope-error', async () => {
    const execa = makeOk('garbled non-json output');

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca }),
    );

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.reason).toBe('envelope-error');
    expect(result.envelopeParseError).toContain('JSON.parse failed');
    await expect(fs.access(result.failedMarkerPath)).resolves.toBeUndefined();
  });

  it('execa throws (claude not on PATH) → spawn-failure + .started still written', async () => {
    const execa = makeThrow('ENOENT', 'spawn claude ENOENT');

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca }),
    );

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.reason).toBe('spawn-failure');
    expect(result.spawnError).toContain('ENOENT');

    // Pre-fire marker still written even though the spawn never happened —
    // operator must explicitly delete it to retry (intentional friction).
    await expect(fs.access(result.startedMarkerPath)).resolves.toBeUndefined();
    await expect(fs.access(result.failedMarkerPath)).resolves.toBeUndefined();
  });

  it('timeout result → timeout failure + .failed written', async () => {
    const execa = makeTimedOut('{"type":"result","is_error":false}');

    const result = await fireHeadlessSession(
      baseOpts({ execaFn: execa as unknown as typeof realExeca, timeoutMs: 1000 }),
    );

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.reason).toBe('timeout');
    const failedBody = await fs.readFile(result.failedMarkerPath, 'utf8');
    expect(failedBody).toContain('timed out');
    expect(failedBody).toContain('1000ms');
  });
});

describe('fireHeadlessSession — env + timeout resolution', () => {
  it('honors SESSION_ORCHESTRATOR_TIMEOUT_MS env var when timeoutMs not passed', async () => {
    const execa = makeOk('{"type":"result","is_error":false}');
    const opts: FireOptions = {
      repoRoot: tmpRoot,
      phase: 1,
      config: baseConfig,
      kickoffContent: 'k',
      logTimestamp: '2026-01-01T00-00-00-000Z',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      env: { ANTHROPIC_API_KEY: 'k', SESSION_ORCHESTRATOR_TIMEOUT_MS: '12345' },
      execaFn: execa as unknown as typeof realExeca,
    };
    await fireHeadlessSession(opts);
    expect(execa.mock.calls[0]![2].timeout).toBe(12345);
  });

  it('uses default timeout when neither opt nor env provided', async () => {
    const execa = makeOk('{"type":"result","is_error":false}');
    const opts: FireOptions = {
      repoRoot: tmpRoot,
      phase: 1,
      config: baseConfig,
      kickoffContent: 'k',
      logTimestamp: '2026-01-01T00-00-00-000Z',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      env: { ANTHROPIC_API_KEY: 'k' },
      execaFn: execa as unknown as typeof realExeca,
    };
    await fireHeadlessSession(opts);
    expect(execa.mock.calls[0]![2].timeout).toBe(30 * 60 * 1000);
  });

  it('honors SESSION_ORCHESTRATOR_CLAUDE_BIN env override', async () => {
    const execa = makeOk('{"type":"result","is_error":false}');
    const opts: FireOptions = {
      repoRoot: tmpRoot,
      phase: 1,
      config: baseConfig,
      kickoffContent: 'k',
      logTimestamp: '2026-01-01T00-00-00-000Z',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      env: { ANTHROPIC_API_KEY: 'k', SESSION_ORCHESTRATOR_CLAUDE_BIN: '/opt/claude/bin/claude' },
      execaFn: execa as unknown as typeof realExeca,
    };
    await fireHeadlessSession(opts);
    expect(execa.mock.calls[0]![0]).toBe('/opt/claude/bin/claude');
  });
});
