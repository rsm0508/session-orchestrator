import type { Config } from './config.js';
export interface LinearPauseCheckerOptions {
    apiKey: string;
    teamKey: string;
    label?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}
export declare function createLinearPauseChecker(opts: LinearPauseCheckerOptions): () => Promise<boolean>;
export declare function maybeCreateLinearPauseChecker(config: Config, env?: NodeJS.ProcessEnv): (() => Promise<boolean>) | undefined;
//# sourceMappingURL=linear-pause-check.d.ts.map