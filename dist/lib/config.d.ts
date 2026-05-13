import { z } from 'zod';
export declare const CONFIG_RELATIVE_PATH = ".session-orchestrator/config.yml";
export declare const FORBIDDEN_HEADLESS_TOOLS: readonly ["AskUserQuestion"];
export declare const ConfigSchema: z.ZodObject<{
    project_name: z.ZodString;
    feature_branch: z.ZodString;
    handoff_pattern: z.ZodEffects<z.ZodString, string, string>;
    max_phase: z.ZodNumber;
    tracking_issue: z.ZodNumber;
    linear_team: z.ZodOptional<z.ZodString>;
    claude_model: z.ZodDefault<z.ZodString>;
    allowed_tools: z.ZodEffects<z.ZodString, string, string>;
    max_budget_usd: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    project_name: string;
    feature_branch: string;
    handoff_pattern: string;
    max_phase: number;
    tracking_issue: number;
    claude_model: string;
    allowed_tools: string;
    max_budget_usd: number;
    linear_team?: string | undefined;
}, {
    project_name: string;
    feature_branch: string;
    handoff_pattern: string;
    max_phase: number;
    tracking_issue: number;
    allowed_tools: string;
    max_budget_usd: number;
    linear_team?: string | undefined;
    claude_model?: string | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
export declare class ConfigError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
export declare function loadConfig(repoRoot: string): Promise<Config>;
export declare function parseConfig(rawYaml: string, sourceForErrors?: string): Config;
//# sourceMappingURL=config.d.ts.map