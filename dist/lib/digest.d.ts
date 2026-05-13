import type { Config } from './config.js';
import type { FireResult } from './headless-claude.js';
export interface DigestInput {
    result: FireResult;
    config: Config;
    phase: number;
    /**
     * Optional GitHub Actions runner URL. Set in CI via:
     * `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`.
     * Omitted gracefully in local CLI runs.
     */
    runUrl?: string;
}
/**
 * Pick a fence longer than any backtick run inside `text` so embedded code
 * blocks (common in coding-session results) don't close the digest's fence
 * early. GitHub-flavored markdown allows any N≥3 backticks as a fence; the
 * closing fence must match.
 */
export declare function chooseFence(text: string): string;
export declare function renderDigest(input: DigestInput): string;
//# sourceMappingURL=digest.d.ts.map