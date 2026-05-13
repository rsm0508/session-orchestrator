import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import {
  failedMarkerRelativePath,
  handoffPathFor,
  resolveNextPhase,
  scanPhases,
  startedMarkerRelativePath,
} from '../phase-resolver.js';

const baseConfig: Config = {
  project_name: 'Test',
  feature_branch: 'feat/x',
  handoff_pattern: 'docs/handoffs/x-phase-{N}-kickoff.md',
  max_phase: 4,
  tracking_issue: 1,
  claude_model: 'claude-opus-4-7',
  allowed_tools: 'Read Write Edit Bash Glob Grep',
  max_budget_usd: 5.0,
};

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'so-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeHandoff(phase: number): Promise<void> {
  const rel = handoffPathFor(baseConfig, phase);
  const abs = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `# Phase ${phase} kickoff\n`, 'utf8');
}

async function writeStartedMarker(phase: number): Promise<void> {
  const rel = startedMarkerRelativePath(phase);
  const abs = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `started phase ${phase} at ${new Date().toISOString()}\n`, 'utf8');
}

async function writeFailedMarker(phase: number): Promise<void> {
  const rel = failedMarkerRelativePath(phase);
  const abs = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `failed phase ${phase} at ${new Date().toISOString()}\n`, 'utf8');
}

describe('handoffPathFor', () => {
  it('substitutes {N} once', () => {
    expect(handoffPathFor(baseConfig, 3)).toBe('docs/handoffs/x-phase-3-kickoff.md');
  });
});

describe('startedMarkerRelativePath', () => {
  it('writes under .session-orchestrator/', () => {
    expect(startedMarkerRelativePath(2)).toBe('.session-orchestrator/phase-2.started');
  });
});

describe('scanPhases', () => {
  it('returns every phase up to max with correct existence flags (including .failed)', async () => {
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeFailedMarker(1);
    await writeHandoff(2);
    // phase 3 + 4: nothing
    const phases = await scanPhases(tmpRoot, baseConfig);
    expect(phases).toHaveLength(4);
    expect(phases[0]).toMatchObject({
      phase: 1,
      handoffExists: true,
      startedMarkerExists: true,
      failedMarkerExists: true,
    });
    expect(phases[1]).toMatchObject({
      phase: 2,
      handoffExists: true,
      startedMarkerExists: false,
      failedMarkerExists: false,
    });
    expect(phases[2]).toMatchObject({
      phase: 3,
      handoffExists: false,
      startedMarkerExists: false,
      failedMarkerExists: false,
    });
    expect(phases[3]).toMatchObject({
      phase: 4,
      handoffExists: false,
      startedMarkerExists: false,
      failedMarkerExists: false,
    });
  });
});

describe('resolveNextPhase', () => {
  it('returns ready for phase 1 on cold start (handoff present, no marker)', async () => {
    await writeHandoff(1);
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('ready');
    if (r.kind === 'ready') {
      expect(r.phase).toBe(1);
      expect(r.handoffPath).toBe('docs/handoffs/x-phase-1-kickoff.md');
    }
  });

  it('returns ready for phase 2 when phase 1 has a started-marker AND phase 2 handoff exists', async () => {
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeHandoff(2);
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('ready');
    if (r.kind === 'ready') expect(r.phase).toBe(2);
  });

  it('returns not-ready (no-handoff-for-next-phase) when phase 1 started but phase 2 kickoff missing', async () => {
    await writeHandoff(1);
    await writeStartedMarker(1);
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');
    if (r.kind === 'not-ready') {
      expect(r.reason).toBe('no-handoff-for-next-phase');
      expect(r.details).toContain('Phase 2');
    }
  });

  it('returns not-ready (all-phases-started) when every phase has a marker', async () => {
    for (let i = 1; i <= 4; i++) {
      await writeHandoff(i);
      await writeStartedMarker(i);
    }
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');
    if (r.kind === 'not-ready') expect(r.reason).toBe('all-phases-started');
  });

  it('does NOT fire past max_phase even if a higher handoff exists', async () => {
    const tightConfig: Config = { ...baseConfig, max_phase: 2 };
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeHandoff(2);
    await writeStartedMarker(2);
    await writeHandoff(3); // a stray; shouldn't be considered
    const r = await resolveNextPhase(tmpRoot, tightConfig);
    expect(r.kind).toBe('not-ready');
    if (r.kind === 'not-ready') expect(r.reason).toBe('all-phases-started');
  });

  it('returns not-ready (no-handoff) when nothing exists at all', async () => {
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');
    if (r.kind === 'not-ready') expect(r.reason).toBe('no-handoff-for-next-phase');
  });

  it('returns not-ready (phase-failed-blocked) when phase 1 has both .started and .failed', async () => {
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeFailedMarker(1);
    await writeHandoff(2);
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');
    if (r.kind === 'not-ready') {
      expect(r.reason).toBe('phase-failed-blocked');
      expect(r.details).toContain('Phase 1');
      expect(r.details).toContain('.failed');
    }
  });

  it('phase-failed-blocked wins over no-handoff-for-next-phase', async () => {
    // Phase 1 failed (blocks). Phase 2 also has no handoff (would otherwise be reported).
    // The orchestrator must surface the failure first — that's the operator's immediate
    // action item.
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeFailedMarker(1);
    // No handoff for phase 2.
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');
    if (r.kind === 'not-ready') expect(r.reason).toBe('phase-failed-blocked');
  });

  it('phase becomes ready again only after BOTH .started and .failed are deleted', async () => {
    // Failure state.
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeFailedMarker(1);
    let r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');

    // Operator deletes only .started (the old buggy retry path) — still blocked.
    await fs.unlink(path.join(tmpRoot, startedMarkerRelativePath(1)));
    r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('not-ready');

    // Now also delete .failed — phase becomes ready.
    await fs.unlink(path.join(tmpRoot, failedMarkerRelativePath(1)));
    r = await resolveNextPhase(tmpRoot, baseConfig);
    expect(r.kind).toBe('ready');
    if (r.kind === 'ready') expect(r.phase).toBe(1);
  });

  it('deleting only .failed (marking phase as done) blocks readiness — phase is past', async () => {
    // Failed state.
    await writeHandoff(1);
    await writeStartedMarker(1);
    await writeFailedMarker(1);
    await writeHandoff(2);
    // Operator decides "actually that phase IS done, skip retry": delete .failed only.
    await fs.unlink(path.join(tmpRoot, failedMarkerRelativePath(1)));
    const r = await resolveNextPhase(tmpRoot, baseConfig);
    // Phase 1 keeps .started (audit trail). Phase 2 should be ready.
    expect(r.kind).toBe('ready');
    if (r.kind === 'ready') expect(r.phase).toBe(2);
  });
});
