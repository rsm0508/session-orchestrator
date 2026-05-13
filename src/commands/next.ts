import { Command, Flags } from '@oclif/core';
import { loadConfig, ConfigError } from '../lib/config.js';
import { resolveNextPhase } from '../lib/phase-resolver.js';
import { checkKillSwitch } from '../lib/kill-switch.js';
import { maybeCreateLinearPauseChecker } from '../lib/linear-pause-check.js';
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
    json: Flags.boolean({
      description:
        'Emit a single-line JSON status object (for CI consumption). Suppresses text output.',
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

    const kill = await checkKillSwitch({
      repoRoot,
      checkLinearLabel: maybeCreateLinearPauseChecker(config),
    });
    if (kill.active) {
      if (flags.json) {
        this.log(
          JSON.stringify({ kind: 'kill-switch', sources: kill.sources, details: kill.details }),
        );
        this.exit(0);
      }
      this.log(`[kill-switch] ${kill.details}`);
      this.log('No phase will fire while a kill switch is active.');
      this.exit(0);
    }

    const next = await resolveNextPhase(repoRoot, config);

    if (next.kind === 'not-ready') {
      if (flags.json) {
        this.log(JSON.stringify({ kind: 'not-ready', reason: next.reason, details: next.details }));
        this.exit(0);
      }
      this.log(`[not-ready] ${next.reason}: ${next.details}`);
      for (const status of next.scanned) {
        const handoff = status.handoffExists ? 'handoff:yes' : 'handoff:no ';
        const marker = status.startedMarkerExists ? 'started:yes' : 'started:no ';
        this.log(`  phase ${status.phase}  ${handoff}  ${marker}  ${status.handoffPath}`);
      }
      this.exit(0);
    }

    if (flags.json) {
      this.log(
        JSON.stringify({
          kind: 'ready',
          phase: next.phase,
          handoff: next.handoffPath,
          startedMarker: next.startedMarkerPath,
          project: config.project_name,
          feature_branch: config.feature_branch,
          model: config.claude_model,
          tracking_issue: config.tracking_issue,
        }),
      );
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

    // `next` reports only. Firing is `run --phase N` — keeping the two as
    // separate commands keeps `next` cheap to call from a cron without ever
    // accidentally writing a marker or invoking the model.
    this.log(
      `Note: \`next\` reports only. To fire, run \`session-orchestrator run --phase ${next.phase}\`.`,
    );
  }
}
