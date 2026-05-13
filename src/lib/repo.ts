import path from 'node:path';

/**
 * Resolves the consumer repo root for a CLI invocation. The --repo flag wins if
 * provided; otherwise cwd is assumed. Relative paths are resolved against cwd.
 */
export function resolveRepoRoot(repoFlag: string | undefined): string {
  if (!repoFlag) return process.cwd();
  return path.isAbsolute(repoFlag) ? repoFlag : path.resolve(process.cwd(), repoFlag);
}
