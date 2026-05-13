import { promises as fs } from 'node:fs';
import path from 'node:path';
export const PAUSE_FILE_NAME = '.session-orchestrator-paused';
export const PAUSE_ENV_VAR = 'SESSION_ORCHESTRATOR_PAUSED';
export const LINEAR_PAUSE_LABEL = 'orchestrator-paused';
/**
 * Checks all three kill-switch paths in parallel. ANY active source halts the run.
 * Returning the full source list (not just first-hit) lets the digest comment
 * tell the operator exactly what to flip to resume.
 */
export async function checkKillSwitch(opts) {
    const env = opts.env ?? process.env;
    const filePath = path.join(opts.repoRoot, PAUSE_FILE_NAME);
    const [fileActive, linearActive] = await Promise.all([
        pathExists(filePath),
        opts.checkLinearLabel ? opts.checkLinearLabel().catch(() => false) : Promise.resolve(false),
    ]);
    const envActive = isTruthyEnvValue(env[PAUSE_ENV_VAR]);
    const sources = [];
    if (fileActive)
        sources.push('file');
    if (envActive)
        sources.push('env');
    if (linearActive)
        sources.push('linear-label');
    if (sources.length === 0) {
        return { active: false };
    }
    return {
        active: true,
        sources,
        details: formatActiveSources(sources, filePath),
    };
}
export async function pauseLocal(repoRoot, reason) {
    const filePath = path.join(repoRoot, PAUSE_FILE_NAME);
    const body = reason
        ? `paused at ${new Date().toISOString()}\nreason: ${reason}\n`
        : `paused at ${new Date().toISOString()}\n`;
    await fs.writeFile(filePath, body, 'utf8');
    return filePath;
}
export async function resumeLocal(repoRoot) {
    const filePath = path.join(repoRoot, PAUSE_FILE_NAME);
    try {
        await fs.unlink(filePath);
        return { removed: true, path: filePath };
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return { removed: false, path: filePath };
        }
        throw err;
    }
}
function isTruthyEnvValue(raw) {
    if (!raw)
        return false;
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
async function pathExists(absolutePath) {
    try {
        await fs.access(absolutePath);
        return true;
    }
    catch {
        return false;
    }
}
function formatActiveSources(sources, filePath) {
    const parts = sources.map((s) => {
        switch (s) {
            case 'file':
                return `repo pause file (${filePath})`;
            case 'env':
                return `env var ${PAUSE_ENV_VAR}`;
            case 'linear-label':
                return `Linear label "${LINEAR_PAUSE_LABEL}"`;
        }
    });
    return `Kill switch active via: ${parts.join(', ')}`;
}
//# sourceMappingURL=kill-switch.js.map