import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Command, Flags } from '@oclif/core';
import { loadConfig, ConfigError } from '../lib/config.js';
import {
  handoffPathFor,
  startedMarkerRelativePath,
  MARKERS_DIR,
} from '../lib/phase-resolver.js';
import { checkKillSwitch } from '../lib/kill-switch.js';
import { resolveRepoRoot } from '../lib/repo.js';

export default class Run extends Command {
  static description = 'Fire a specific phase by number (manual override).';

  static examples = [
    '<%= config.bin %> <%= command.id %> --phase 2 --dry-run',
    '<%= config.bin %> <%= command.id %> --phase 2',
  ];

  static flags = {
    repo: Flags.string({
      description: 'Consumer repo root (defaults to cwd).',
    }),
    phase: Flags.integer({
      description: 'Phase number to fire (1-indexed).',
      required: true,
    }),
    'dry-run': Flags.boolean({
      description: 'Report only; never write markers or fire sessions.',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Run);
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

    if (flags.phase < 1 || flags.phase > config.max_phase) {
      this.error(`--phase ${flags.phase} is out of range 1..${config.max_phase}`, { exit: 2 });
    }

    const handoffRel = handoffPathFor(config, flags.phase);
    const markerRel = startedMarkerRelativePath(flags.phase);
    const handoffAbs = path.join(repoRoot, handoffRel);
    const markerAbs = path.join(repoRoot, markerRel);

    let handoffExists = true;
    try {
      await fs.access(handoffAbs);
    } catch {
      handoffExists = false;
    }

    if (!handoffExists) {
      this.error(`No kickoff doc at ${handoffRel}. Author it before firing this phase.`, {
        exit: 2,
      });
    }

    let markerExists = false;
    try {
      await fs.access(markerAbs);
      markerExists = true;
    } catch {
      // expected
    }

    if (markerExists) {
      this.error(
        `Phase ${flags.phase} already has a started-marker at ${markerRel}. ` +
          'Delete it to allow re-firing (intentional friction — see README).',
        { exit: 2 },
      );
    }

    const kill = await checkKillSwitch({ repoRoot });
    if (kill.active) {
      this.error(`Cannot fire: ${kill.details}`, { exit: 3 });
    }

    this.log(`[fire] phase ${flags.phase} of project "${config.project_name}"`);
    this.log(`  kickoff: ${handoffRel}`);
    this.log(`  marker:  ${markerRel}`);
    this.log(`  model:   ${config.claude_model}`);
    this.log(`  branch:  ${config.feature_branch}`);

    if (flags['dry-run']) {
      this.log('--dry-run: not writing marker, not invoking claude.');
      this.exit(0);
    }

    // Day 1 v0.1.0-pre: the headless Claude Code invocation is NOT yet wired.
    // Writing the started-marker without firing the session would leave the
    // consumer repo claiming "phase started" when no session actually ran —
    // worse than not running at all. So `run` without --dry-run hard-fails
    // here until Day 2 lands. The marker write is the LAST step before the
    // execa-to-`claude --print` call so the two land atomically in Day 2.
    this.error(
      'Headless Claude invocation not yet wired (Day 2 scope). ' +
        'Re-run with --dry-run to verify config + kill-switch + phase resolution. ' +
        'See docs/handoffs/day-2-kickoff.md.',
      { exit: 4 },
    );

    // Day 2 will replace the error above with the following sequence:
    //   1. Read handoff doc contents
    //   2. Ensure MARKERS_DIR exists in repo
    //   3. Write marker file (atomic precondition for the fire)
    //   4. execa('claude', ['--print', handoffContent], { cwd: repoRoot, stdio: ['inherit', 'pipe', 'pipe'] })
    //   5. Persist run log + post digest comment
    // The MARKERS_DIR import above is kept to avoid an unused-import warning later.
    void MARKERS_DIR;
  }
}
