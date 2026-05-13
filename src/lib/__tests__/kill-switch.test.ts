import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAUSE_ENV_VAR,
  PAUSE_FILE_NAME,
  checkKillSwitch,
  pauseLocal,
  resumeLocal,
} from '../kill-switch.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'so-kill-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('checkKillSwitch', () => {
  it('is inactive when no file, no env, no linear', async () => {
    const status = await checkKillSwitch({ repoRoot: tmpRoot, env: {} });
    expect(status.active).toBe(false);
  });

  it('activates on the file path', async () => {
    await fs.writeFile(path.join(tmpRoot, PAUSE_FILE_NAME), 'paused\n', 'utf8');
    const status = await checkKillSwitch({ repoRoot: tmpRoot, env: {} });
    expect(status.active).toBe(true);
    if (status.active) expect(status.sources).toEqual(['file']);
  });

  it('activates on the env var (true/yes/1; case insensitive)', async () => {
    for (const v of ['true', 'TRUE', 'yes', '1', '  true  ']) {
      const status = await checkKillSwitch({
        repoRoot: tmpRoot,
        env: { [PAUSE_ENV_VAR]: v },
      });
      expect(status.active).toBe(true);
      if (status.active) expect(status.sources).toContain('env');
    }
  });

  it('does NOT activate on env values like "false", "0", "no", empty', async () => {
    for (const v of ['false', '0', 'no', '']) {
      const status = await checkKillSwitch({
        repoRoot: tmpRoot,
        env: { [PAUSE_ENV_VAR]: v },
      });
      expect(status.active).toBe(false);
    }
  });

  it('activates on the linear-label seam', async () => {
    const status = await checkKillSwitch({
      repoRoot: tmpRoot,
      env: {},
      checkLinearLabel: async () => true,
    });
    expect(status.active).toBe(true);
    if (status.active) expect(status.sources).toEqual(['linear-label']);
  });

  it('swallows linear-label checker errors as inactive (defense in depth)', async () => {
    const status = await checkKillSwitch({
      repoRoot: tmpRoot,
      env: {},
      checkLinearLabel: async () => {
        throw new Error('Linear API down');
      },
    });
    expect(status.active).toBe(false);
  });

  it('reports ALL active sources when multiple trip simultaneously', async () => {
    await fs.writeFile(path.join(tmpRoot, PAUSE_FILE_NAME), 'paused\n', 'utf8');
    const status = await checkKillSwitch({
      repoRoot: tmpRoot,
      env: { [PAUSE_ENV_VAR]: 'true' },
      checkLinearLabel: async () => true,
    });
    expect(status.active).toBe(true);
    if (status.active) {
      expect(status.sources).toEqual(['file', 'env', 'linear-label']);
    }
  });
});

describe('pauseLocal / resumeLocal', () => {
  it('round-trips: pause creates, resume removes', async () => {
    const filePath = await pauseLocal(tmpRoot, 'investigating');
    expect(filePath).toBe(path.join(tmpRoot, PAUSE_FILE_NAME));
    const body = await fs.readFile(filePath, 'utf8');
    expect(body).toContain('investigating');

    const r1 = await resumeLocal(tmpRoot);
    expect(r1.removed).toBe(true);

    // idempotent: second resume reports "already clear"
    const r2 = await resumeLocal(tmpRoot);
    expect(r2.removed).toBe(false);
  });

  it('pause without reason still writes a timestamp', async () => {
    const filePath = await pauseLocal(tmpRoot);
    const body = await fs.readFile(filePath, 'utf8');
    expect(body).toMatch(/paused at \d{4}-\d{2}-\d{2}/);
  });
});
