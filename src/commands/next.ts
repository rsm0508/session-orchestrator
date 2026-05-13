import { Command, Flags } from '@oclif/core';
import { loadConfig, ConfigError } from '../lib/config.js';
import { resolveNextPhase } from '../lib/phase-resolver.js';
import { checkKillSwitch } from '../lib/kill-switch.js';
import { resolveRepoRoot } from '../lib/repo.js';

export default class Next extends Command {
  static description =
    'Scan the consumer repo for the next ready phase and report what would happen.';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --repo C:\\path\\to\\consumer',
  ];

  static flags = {
    repo: Flags.string({
      description: 'Consumer repo root (defaults to cwd).',
    }),
    'dry-run': Flags.boolean({
      description: 'Report only; never write markers or fire sessions.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Next);
    const repoRoot = resolveRepoRoot(flags.repo);

    let config;
    try {
      config = await loadConfig(repoRoot);
    } catch (err) {
      if (err instanceof ConfigError) {
        this.error(err.message, { exit: 2 });
      }
      throw err;
    }

    const kill = await checkKillSwitch({ repoRoot });
    if (kill.active) {
      this.log(`[kill-switch] ${kill.details}`);
      this.log('No phase will fire while a kill switch is active.');
      this.exit(0);
    }

    const next = await resolveNextPhase(repoRoot, config);

    if (next.kind === 'not-ready') {
      this.log(`[not-ready] ${next.reason}: ${next.details}`);
      for (const status of next.scanned) {
        const handoff = status.handoffExists ? 'handoff:yes' : 'handoff:no ';
        const marker = status.startedMarkerExists ? 'started:yes' : 'started:no ';
        this.log(`  phase ${status.phase}  ${handoff}  ${marker}  ${status.handoffPath}`);
      }
      this.exit(0);
    }

    this.log(`[ready] phase ${next.phase} of project "${config.project_name}"`);
    this.log(`  kickoff: ${next.handoffPath}`);
    this.log(`  marker:  ${next.startedMarkerPath} (would be written on fire)`);
    this.log(`  model:   ${config.claude_model}`);
    this.log(`  branch:  ${config.feature_branch}`);

    if (flags['dry-run']) {
      this.log('--dry-run: not firing. Re-run without --dry-run to fire.');
      this.exit(0);
    }

    // Day 1 scope: this command intentionally does NOT fire the session.
    // Use `session-orchestrator run --phase N` to fire (Day 2 will wire the
    // headless invocation; today, even that command refuses to fire to avoid
    // leaving a started-marker without a session).
    this.log(
      'Note: `next` reports only. To fire, use `session-orchestrator run --phase ' +
        next.phase +
        '`. Headless invocation lands in Day 2 (see docs/handoffs/day-2-kickoff.md).',
    );
  }
}
