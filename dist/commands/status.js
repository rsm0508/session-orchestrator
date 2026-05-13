import { Command, Flags } from '@oclif/core';
import { loadConfig, ConfigError } from '../lib/config.js';
import { scanPhases } from '../lib/phase-resolver.js';
import { checkKillSwitch } from '../lib/kill-switch.js';
import { resolveRepoRoot } from '../lib/repo.js';
export default class Status extends Command {
    static description = 'Report current orchestrator state: kill switches + per-phase status.';
    static flags = {
        repo: Flags.string({
            description: 'Consumer repo root (defaults to cwd).',
        }),
    };
    async run() {
        const { flags } = await this.parse(Status);
        const repoRoot = resolveRepoRoot(flags.repo);
        let config;
        try {
            config = await loadConfig(repoRoot);
        }
        catch (err) {
            if (err instanceof ConfigError) {
                this.error(err.message, { exit: 2 });
            }
            throw err;
        }
        this.log(`project:        ${config.project_name}`);
        this.log(`feature_branch: ${config.feature_branch}`);
        this.log(`max_phase:      ${config.max_phase}`);
        this.log(`model:          ${config.claude_model}`);
        if (config.linear_team) {
            this.log(`linear_team:    ${config.linear_team}`);
        }
        this.log('');
        const kill = await checkKillSwitch({ repoRoot });
        if (kill.active) {
            this.log(`kill-switch:    ACTIVE — ${kill.details}`);
        }
        else {
            this.log('kill-switch:    inactive (no file / env / Linear-label flags set)');
        }
        this.log('');
        const phases = await scanPhases(repoRoot, config);
        this.log('phases:');
        for (const p of phases) {
            const handoff = p.handoffExists ? 'handoff:yes' : 'handoff:no ';
            const marker = p.startedMarkerExists ? 'started:yes' : 'started:no ';
            const failed = p.failedMarkerExists ? 'failed:yes' : 'failed:no ';
            let label;
            if (!p.handoffExists && !p.startedMarkerExists && !p.failedMarkerExists) {
                label = 'pending';
            }
            else if (!p.handoffExists && (p.startedMarkerExists || p.failedMarkerExists)) {
                label = 'marker-without-handoff (manual cleanup?)';
            }
            else if (p.failedMarkerExists) {
                label = 'FAILED (blocked — operator must clear markers)';
            }
            else if (p.startedMarkerExists) {
                label = 'in-flight/done';
            }
            else {
                label = 'READY';
            }
            this.log(`  phase ${String(p.phase).padEnd(2)}  ${handoff}  ${marker}  ${failed}  [${label}]  ${p.handoffPath}`);
        }
    }
}
//# sourceMappingURL=status.js.map