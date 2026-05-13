import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';

export const MARKERS_DIR = '.session-orchestrator';

export interface PhaseStatus {
  phase: number;
  handoffPath: string;
  handoffExists: boolean;
  startedMarkerPath: string;
  startedMarkerExists: boolean;
  failedMarkerPath: string;
  failedMarkerExists: boolean;
}

export interface NextPhaseReady {
  kind: 'ready';
  phase: number;
  handoffPath: string;
  startedMarkerPath: string;
}

export interface NextPhaseNotReady {
  kind: 'not-ready';
  reason:
    | 'no-handoff-for-next-phase'
    | 'all-phases-started'
    | 'past-max-phase'
    | 'next-phase-already-started'
    | 'phase-failed-blocked';
  details: string;
  scanned: PhaseStatus[];
}

export type NextPhaseResolution = NextPhaseReady | NextPhaseNotReady;

export function handoffPathFor(config: Config, phase: number): string {
  return config.handoff_pattern.replace('{N}', String(phase));
}

export function startedMarkerRelativePath(phase: number): string {
  return path.posix.join(MARKERS_DIR, `phase-${phase}.started`);
}

export function failedMarkerRelativePath(phase: number): string {
  return path.posix.join(MARKERS_DIR, `phase-${phase}.failed`);
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function scanPhases(repoRoot: string, config: Config): Promise<PhaseStatus[]> {
  const phases: PhaseStatus[] = [];
  for (let phase = 1; phase <= config.max_phase; phase++) {
    const handoffRel = handoffPathFor(config, phase);
    const startedRel = startedMarkerRelativePath(phase);
    const failedRel = failedMarkerRelativePath(phase);
    const handoffAbs = path.join(repoRoot, handoffRel);
    const startedAbs = path.join(repoRoot, startedRel);
    const failedAbs = path.join(repoRoot, failedRel);
    const [handoffExists, startedMarkerExists, failedMarkerExists] = await Promise.all([
      pathExists(handoffAbs),
      pathExists(startedAbs),
      pathExists(failedAbs),
    ]);
    phases.push({
      phase,
      handoffPath: handoffRel,
      handoffExists,
      startedMarkerPath: startedRel,
      startedMarkerExists,
      failedMarkerPath: failedRel,
      failedMarkerExists,
    });
  }
  return phases;
}

/**
 * Determines the next phase to fire. Rule (per locked product decision + Codex
 * review round 1):
 *   A phase N is "ready" iff handoff exists AND both .started AND .failed
 *   markers are absent.
 *
 * `.failed` blocks readiness so a stale failed run can't be retried by deleting
 * only `.started` — the operator must consciously clear both markers, which is
 * the only way to convert "failed, needs attention" → "ready to retry".
 *
 * We scan from phase 1 upward and pick the FIRST ready phase.
 */
export async function resolveNextPhase(
  repoRoot: string,
  config: Config,
): Promise<NextPhaseResolution> {
  const phases = await scanPhases(repoRoot, config);

  // ANY failed phase blocks the whole orchestrator globally — phase N+1's
  // kickoff usually assumes phase N completed correctly, so silently advancing
  // past a failed phase would mask real problems. Operator must clear both
  // markers (retry) or just .failed (mark done) to unblock.
  const failedBlocked = phases.find((p) => p.failedMarkerExists);
  if (failedBlocked) {
    return {
      kind: 'not-ready',
      reason: 'phase-failed-blocked',
      details:
        `Phase ${failedBlocked.phase} has a .failed marker at ${failedBlocked.failedMarkerPath} — ` +
        'orchestrator refuses to advance until an operator deletes both .started and .failed (to retry) ' +
        'or just .failed (to mark the phase done without retrying).',
      scanned: phases,
    };
  }

  for (const status of phases) {
    if (status.handoffExists && !status.startedMarkerExists && !status.failedMarkerExists) {
      return {
        kind: 'ready',
        phase: status.phase,
        handoffPath: status.handoffPath,
        startedMarkerPath: status.startedMarkerPath,
      };
    }
  }

  const allStarted = phases.every((p) => p.startedMarkerExists);
  if (allStarted) {
    return {
      kind: 'not-ready',
      reason: 'all-phases-started',
      details: `All ${config.max_phase} phases have started-markers. Project complete (or markers need rolling back manually).`,
      scanned: phases,
    };
  }

  const someHandoffMissing = phases.some(
    (p) => !p.handoffExists && !p.startedMarkerExists && !p.failedMarkerExists,
  );
  if (someHandoffMissing) {
    const first = phases.find(
      (p) => !p.handoffExists && !p.startedMarkerExists && !p.failedMarkerExists,
    )!;
    return {
      kind: 'not-ready',
      reason: 'no-handoff-for-next-phase',
      details: `Phase ${first.phase} has no kickoff doc yet at ${first.handoffPath}. Author it before the orchestrator can fire.`,
      scanned: phases,
    };
  }

  return {
    kind: 'not-ready',
    reason: 'next-phase-already-started',
    details: 'No phase is in the (handoff-present, no-markers) state.',
    scanned: phases,
  };
}
