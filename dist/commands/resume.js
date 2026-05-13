import { Command, Flags } from '@oclif/core';
import { resumeLocal, PAUSE_ENV_VAR, LINEAR_PAUSE_LABEL } from '../lib/kill-switch.js';
import { resolveRepoRoot } from '../lib/repo.js';
export default class Resume extends Command {
    static description = 'Remove the repo-level kill-switch file. Note: env var and Linear-label paths must be cleared separately.';
    static flags = {
        repo: Flags.string({
            description: 'Consumer repo root (defaults to cwd).',
        }),
    };
    async run() {
        const { flags } = await this.parse(Resume);
        const repoRoot = resolveRepoRoot(flags.repo);
        const result = await resumeLocal(repoRoot);
        if (result.removed) {
            this.log(`[resumed] removed ${result.path}`);
        }
        else {
            this.log(`[resumed] no pause file at ${result.path} (already clear)`);
        }
        this.log(`Reminder: env var ${PAUSE_ENV_VAR} and Linear label "${LINEAR_PAUSE_LABEL}" can also halt runs — clear those separately if set.`);
    }
}
//# sourceMappingURL=resume.js.map