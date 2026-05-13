import { execa as defaultExeca } from 'execa';
import type { Config } from './config.js';
export declare const RUNS_SUBDIR = "runs";
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const HEADLESS_TIMEOUT_ENV = "SESSION_ORCHESTRATOR_TIMEOUT_MS";
export declare const CLAUDE_BIN_ENV = "SESSION_ORCHESTRATOR_CLAUDE_BIN";
export type ClaudeResultEnvelope = {
    type?: string;
    subtype?: string;
    is_error?: boolean;
    result?: string;
    duration_ms?: number;
    duration_api_ms?: number;
    num_turns?: number;
    total_cost_usd?: number;
    session_id?: string;
    uuid?: string;
    stop_reason?: string;
    errors?: string[];
    permission_denials?: unknown[];
    modelUsage?: Record<string, unknown>;
    api_error_status?: string | null;
    terminal_reason?: string;
};
export type FireFailureReason = 'marker-collision' | 'spawn-failure' | 'non-zero-exit' | 'envelope-error' | 'timeout';
export interface FireSuccess {
    kind: 'success';
    exitCode: 0;
    durationMs: number;
    envelope: ClaudeResultEnvelope;
    logPath: string;
    startedMarkerPath: string;
}
export interface FireFailure {
    kind: 'failure';
    reason: FireFailureReason;
    exitCode: number;
    durationMs: number;
    envelope?: ClaudeResultEnvelope;
    envelopeParseError?: string;
    spawnError?: string;
    logPath: string;
    startedMarkerPath: string;
    failedMarkerPath: string;
}
export type FireResult = FireSuccess | FireFailure;
export interface FireOptions {
    repoRoot: string;
    phase: number;
    config: Config;
    kickoffContent: string;
    /** Injectable for tests. Defaults to real `execa`. */
    execaFn?: typeof defaultExeca;
    /** Injectable timestamp for deterministic log file names in tests. */
    logTimestamp?: string;
    /** Wall-clock timeout (ms). Defaults to env override or DEFAULT_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Injectable env for tests. Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
    /** Injectable now() for stamping markers. Defaults to () => new Date(). */
    now?: () => Date;
}
export interface BuildArgsInput {
    config: Config;
}
export declare function buildClaudeArgs(input: BuildArgsInput): string[];
export declare function parseEnvelope(stdout: string): {
    envelope?: ClaudeResultEnvelope;
    error?: string;
};
export declare function fireHeadlessSession(opts: FireOptions): Promise<FireResult>;
//# sourceMappingURL=headless-claude.d.ts.map