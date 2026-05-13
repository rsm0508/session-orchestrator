import { Command, Flags } from '@oclif/core';
import { pauseLocal } from '../lib/kill-switch.js';
import { resolveRepoRoot } from '../lib/repo.js';

export default class Pause extends Command {
  static description =
    'Create the repo-level kill-switch file (.session-orchestrator-paused). Stops future runs in this repo.';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --reason "investigating Phase 2 PR review failure"',
  ];

  static flags = {
    repo: Flags.string({
      description: 'Consumer repo root (defaults to cwd).',
    }),
    reason: Flags.string({
      description: 'Free-text reason recorded in the pause file body.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Pause);
    const repoRoot = resolveRepoRoot(flags.repo);
    const filePath = await pauseLocal(repoRoot, flags.reason);
    this.log(`[paused] wrote ${filePath}`);
    this.log(
      'Future runs in this repo are halted. The env var and Linear-label paths are independent — flip them separately if needed.',
    );
  }
}
