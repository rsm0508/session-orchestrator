import { describe, expect, it, vi } from 'vitest';
import {
  createLinearPauseChecker,
  maybeCreateLinearPauseChecker,
} from '../linear-pause-check.js';
import type { Config } from '../config.js';

const baseConfig: Config = {
  project_name: 'Test',
  feature_branch: 'feat/test',
  handoff_pattern: 'docs/handoffs/test-phase-{N}.md',
  max_phase: 3,
  tracking_issue: 1,
  claude_model: 'claude-opus-4-7',
  allowed_tools: 'Read Write Edit',
  max_budget_usd: 0.5,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }) as Response;
}

describe('createLinearPauseChecker', () => {
  it('returns true when Linear returns at least one matching issue', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { issues: { nodes: [{ id: 'iss-1' }] } } }),
    );
    const check = createLinearPauseChecker({
      apiKey: 'lin_abc',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await check()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.linear.app/graphql');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('lin_abc');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.variables).toEqual({ teamKey: 'RAN', label: 'orchestrator-paused' });
  });

  it('returns false when Linear returns zero matching issues', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issues: { nodes: [] } } }));
    const check = createLinearPauseChecker({
      apiKey: 'lin_abc',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await check()).toBe(false);
  });

  it('returns false when Linear responds with errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ message: 'forbidden' }] }));
    const check = createLinearPauseChecker({
      apiKey: 'bad',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await check()).toBe(false);
  });

  it('returns false when HTTP status is non-OK', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    const check = createLinearPauseChecker({
      apiKey: 'bad',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await check()).toBe(false);
  });

  it('returns false when fetch throws (network error, etc.)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const check = createLinearPauseChecker({
      apiKey: 'lin_abc',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await check()).toBe(false);
  });

  it('respects a custom label override', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issues: { nodes: [{ id: 'x' }] } } }));
    const check = createLinearPauseChecker({
      apiKey: 'k',
      teamKey: 'RAN',
      label: 'custom-pause',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await check();
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.variables.label).toBe('custom-pause');
  });

  it('excludes both completed and canceled issue states in the query', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issues: { nodes: [] } } }));
    const check = createLinearPauseChecker({
      apiKey: 'k',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await check();
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.query).toContain('"completed", "canceled"');
    expect(body.query).toContain('nin');
  });

  it('aborts via timeout when fetch hangs, returning false (no false-positive halt)', async () => {
    // Simulate a hung Linear API: fetch never resolves until aborted.
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const check = createLinearPauseChecker({
      apiKey: 'k',
      teamKey: 'RAN',
      timeoutMs: 25,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const start = Date.now();
    const result = await check();
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(500); // way under the default 5s; aborted via 25ms timeout
  });

  it('clears the timeout when fetch resolves quickly (no dangling timer)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { issues: { nodes: [] } } }));
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const check = createLinearPauseChecker({
      apiKey: 'k',
      teamKey: 'RAN',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await check();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('maybeCreateLinearPauseChecker', () => {
  it('returns undefined when LINEAR_API_KEY is missing', () => {
    const check = maybeCreateLinearPauseChecker(
      { ...baseConfig, linear_team: 'RAN' },
      { LINEAR_API_KEY: undefined },
    );
    expect(check).toBeUndefined();
  });

  it('returns undefined when linear_team is not configured', () => {
    const check = maybeCreateLinearPauseChecker(baseConfig, {
      LINEAR_API_KEY: 'lin_abc',
    });
    expect(check).toBeUndefined();
  });

  it('returns a checker function when both LINEAR_API_KEY and linear_team are set', () => {
    const check = maybeCreateLinearPauseChecker(
      { ...baseConfig, linear_team: 'RAN' },
      { LINEAR_API_KEY: 'lin_abc' },
    );
    expect(typeof check).toBe('function');
  });
});
