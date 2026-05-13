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
    | 'next-phase-already-started';
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
    const handoffAbs = path.join(repoRoot, handoffRel);
    const startedAbs = path.join(repoRoot, startedRel);
    const [handoffExists, startedMarkerExists] = await Promise.all([
      pathExists(handoffAbs),
      pathExists(startedAbs),
    ]);
    phases.push({
      phase,
      handoffPath: handoffRel,
      handoffExists,
      startedMarkerPath: startedRel,
      startedMarkerExists,
    });
  }
  return phases;
}

/**
 * Determines the next phase to fire. Rule (per locked product decision):
 *   A phase N is "ready" iff its handoff exists AND its started-marker does NOT.
 *
 * We scan from phase 1 upward and pick the FIRST ready phase. This handles the
 * cold-start case (phase 1 with no marker yet) and the steady-state case
 * (phase K+1 ready after phase K's marker landed) with the same loop.
 */
export async function resolveNextPhase(
  repoRoot: string,
  config: Config,
): Promise<NextPhaseResolution> {
  const phases = await scanPhases(repoRoot, config);

  for (const status of phases) {
    if (status.handoffExists && !status.startedMarkerExists) {
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

  const someHandoffMissing = phases.some((p) => !p.handoffExists && !p.startedMarkerExists);
  if (someHandoffMissing) {
    const first = phases.find((p) => !p.handoffExists && !p.startedMarkerExists)!;
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
    details: 'No phase is in the (handoff-present, marker-absent) state.',
    scanned: phases,
  };
}
