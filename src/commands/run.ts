import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Command, Flags } from '@oclif/core';
import { loadConfig, ConfigError } from '../lib/config.js';
import {
  failedMarkerRelativePath,
  handoffPathFor,
  startedMarkerRelativePath,
} from '../lib/phase-resolver.js';
import { checkKillSwitch } from '../lib/kill-switch.js';
import { resolveRepoRoot } from '../lib/repo.js';
import { fireHeadlessSession } from '../lib/headless-claude.js';

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
    const startedRel = startedMarkerRelativePath(flags.phase);
    const failedRel = failedMarkerRelativePath(flags.phase);
    const handoffAbs = path.join(repoRoot, handoffRel);
    const startedAbs = path.join(repoRoot, startedRel);

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
      await fs.access(startedAbs);
      markerExists = true;
    } catch {
      // expected
    }

    if (markerExists) {
      this.error(
        `Phase ${flags.phase} already has a started-marker at ${startedRel}. ` +
          'Delete it (and any .failed sibling) to allow re-firing — intentional friction (see README).',
        { exit: 2 },
      );
    }

    const kill = await checkKillSwitch({ repoRoot });
    if (kill.active) {
      this.error(`Cannot fire: ${kill.details}`, { exit: 3 });
    }

    this.log(`[fire] phase ${flags.phase} of project "${config.project_name}"`);
    this.log(`  kickoff:        ${handoffRel}`);
    this.log(`  marker:         ${startedRel}`);
    this.log(`  model:          ${config.claude_model}`);
    this.log(`  branch:         ${config.feature_branch}`);
    this.log(`  allowed_tools:  ${config.allowed_tools}`);
    this.log(`  max_budget_usd: $${config.max_budget_usd}`);

    if (flags['dry-run']) {
      this.log('--dry-run: not writing marker, not invoking claude.');
      this.exit(0);
    }

    // --bare mode requires ANTHROPIC_API_KEY (or apiKeyHelper via --settings).
    // Without it the headless session returns "Not logged in" and burns ~$0
    // but wastes the runner's time. Hard-fail upfront with a clear pointer.
    if (!process.env.ANTHROPIC_API_KEY) {
      this.error(
        'ANTHROPIC_API_KEY env var is not set. The headless `claude --bare` ' +
          'invocation requires it (OAuth and keychain are NOT read in --bare mode). ' +
          'In GitHub Actions, pass it via `env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }`.',
        { exit: 2 },
      );
    }

    const kickoffContent = await fs.readFile(handoffAbs, 'utf8');

    this.log('[fire] invoking claude (headless)…');

    const result = await fireHeadlessSession({
      repoRoot,
      phase: flags.phase,
      config,
      kickoffContent,
    });

    if (result.kind === 'success') {
      this.log(
        `[fire] OK — exit 0, duration ${result.durationMs}ms, ` +
          `turns=${result.envelope.num_turns ?? '?'}, cost=$${(
            result.envelope.total_cost_usd ?? 0
          ).toFixed(4)}`,
      );
      this.log(`  log:    ${path.relative(repoRoot, result.logPath)}`);
      this.log(`  marker: ${startedRel}`);
      this.exit(0);
    }

    // failure path — .failed marker has already been written by the wrapper.
    this.log(`[fire] FAILED reason=${result.reason} exit=${result.exitCode}`);
    if (result.envelope) {
      this.log(`  envelope.subtype:    ${result.envelope.subtype ?? '(none)'}`);
      this.log(`  envelope.is_error:   ${result.envelope.is_error}`);
      if (result.envelope.result) {
        this.log(`  envelope.result:     ${result.envelope.result.slice(0, 200)}`);
      }
      if (result.envelope.errors?.length) {
        this.log(`  envelope.errors:     ${result.envelope.errors.join('; ')}`);
      }
    }
    if (result.envelopeParseError) {
      this.log(`  envelope_parse_err:  ${result.envelopeParseError}`);
    }
    if (result.spawnError) {
      this.log(`  spawn_error:         ${result.spawnError}`);
    }
    this.log(`  log:    ${path.relative(repoRoot, result.logPath)}`);
    this.log(`  marker: ${startedRel} (+ ${failedRel})`);
    this.log(
      'To retry: delete BOTH the .started and .failed markers, then re-run. ' +
        'To roll back: delete just the .started marker.',
    );
    this.exit(4);
  }
}
