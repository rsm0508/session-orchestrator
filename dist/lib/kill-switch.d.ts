export declare const PAUSE_FILE_NAME = ".session-orchestrator-paused";
export declare const PAUSE_ENV_VAR = "SESSION_ORCHESTRATOR_PAUSED";
export declare const LINEAR_PAUSE_LABEL = "orchestrator-paused";
export type KillSwitchSource = 'file' | 'env' | 'linear-label';
export interface KillSwitchActive {
    active: true;
    sources: KillSwitchSource[];
    details: string;
}
export interface KillSwitchInactive {
    active: false;
}
export type KillSwitchStatus = KillSwitchActive | KillSwitchInactive;
export interface KillSwitchCheckOptions {
    repoRoot: string;
    env?: NodeJS.ProcessEnv;
    /**
     * Optional Linear-label checker. v1.0 ships the file + env paths as load-bearing;
     * the Linear-label path is wired through this seam so the GHA workflow can plug a
     * real Linear API call later without changing the core lib's shape.
     * Return value: true if any open ticket in the configured team carries the pause label.
     */
    checkLinearLabel?: () => Promise<boolean>;
}
/**
 * Checks all three kill-switch paths in parallel. ANY active source halts the run.
 * Returning the full source list (not just first-hit) lets the digest comment
 * tell the operator exactly what to flip to resume.
 */
export declare function checkKillSwitch(opts: KillSwitchCheckOptions): Promise<KillSwitchStatus>;
export declare function pauseLocal(repoRoot: string, reason?: string): Promise<string>;
export declare function resumeLocal(repoRoot: string): Promise<{
    removed: boolean;
    path: string;
}>;
//# sourceMappingURL=kill-switch.d.ts.map