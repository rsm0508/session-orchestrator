import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
export const CONFIG_RELATIVE_PATH = '.session-orchestrator/config.yml';
export const FORBIDDEN_HEADLESS_TOOLS = ['AskUserQuestion'];
export const ConfigSchema = z
    .object({
    project_name: z.string().min(1, 'project_name is required'),
    feature_branch: z.string().min(1, 'feature_branch is required'),
    handoff_pattern: z
        .string()
        .min(1, 'handoff_pattern is required')
        .refine((s) => s.includes('{N}'), {
        message: 'handoff_pattern must contain the literal "{N}" placeholder',
    }),
    max_phase: z.number().int().positive('max_phase must be a positive integer'),
    tracking_issue: z.number().int().positive('tracking_issue must be a positive integer'),
    linear_team: z.string().min(1).optional(),
    claude_model: z.string().min(1).default('claude-opus-4-7'),
    allowed_tools: z
        .string()
        .min(1, 'allowed_tools is required (passed verbatim to claude --allowedTools)')
        .refine((s) => !FORBIDDEN_HEADLESS_TOOLS.some((forbidden) => s.includes(forbidden)), {
        message: `allowed_tools must not include ${FORBIDDEN_HEADLESS_TOOLS.join(', ')} — these would hang a headless session waiting for operator input`,
    }),
    max_budget_usd: z
        .number()
        .positive('max_budget_usd must be a positive number (hard $ cap per phase fire)'),
})
    .strict();
export class ConfigError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'ConfigError';
    }
}
export async function loadConfig(repoRoot) {
    const configPath = path.join(repoRoot, CONFIG_RELATIVE_PATH);
    let raw;
    try {
        raw = await fs.readFile(configPath, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            throw new ConfigError(`No config file at ${configPath}`, err);
        }
        throw new ConfigError(`Could not read ${configPath}`, err);
    }
    return parseConfig(raw, configPath);
}
export function parseConfig(rawYaml, sourceForErrors = '<config>') {
    let parsedYaml;
    try {
        parsedYaml = yaml.load(rawYaml);
    }
    catch (err) {
        throw new ConfigError(`Invalid YAML in ${sourceForErrors}`, err);
    }
    if (parsedYaml === null || typeof parsedYaml !== 'object') {
        throw new ConfigError(`Config in ${sourceForErrors} must be a YAML mapping`);
    }
    const result = ConfigSchema.safeParse(parsedYaml);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n');
        throw new ConfigError(`Config validation failed in ${sourceForErrors}:\n${issues}`);
    }
    return result.data;
}
//# sourceMappingURL=config.js.map