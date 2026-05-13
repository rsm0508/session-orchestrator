import type { Config } from './config.js';
export declare const MARKERS_DIR = ".session-orchestrator";
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
    reason: 'no-handoff-for-next-phase' | 'all-phases-started' | 'past-max-phase' | 'next-phase-already-started' | 'phase-failed-blocked';
    details: string;
    scanned: PhaseStatus[];
}
export type NextPhaseResolution = NextPhaseReady | NextPhaseNotReady;
export declare function handoffPathFor(config: Config, phase: number): string;
export declare function startedMarkerRelativePath(phase: number): string;
export declare function failedMarkerRelativePath(phase: number): string;
export declare function scanPhases(repoRoot: string, config: Config): Promise<PhaseStatus[]>;
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
export declare function resolveNextPhase(repoRoot: string, config: Config): Promise<NextPhaseResolution>;
//# sourceMappingURL=phase-resolver.d.ts.map