import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../config.js';

const REQUIRED_TAIL = `
allowed_tools: "Read Write Edit Bash Glob Grep"
max_budget_usd: 5.00
`;

describe('parseConfig', () => {
  it('parses a valid minimal config', () => {
    const yaml = `
project_name: MCP v1.0
feature_branch: feat/mcp-v1
handoff_pattern: docs/handoffs/mcp-phase-{N}-kickoff.md
max_phase: 4
tracking_issue: 1
${REQUIRED_TAIL}`;
    const cfg = parseConfig(yaml);
    expect(cfg.project_name).toBe('MCP v1.0');
    expect(cfg.feature_branch).toBe('feat/mcp-v1');
    expect(cfg.max_phase).toBe(4);
    expect(cfg.claude_model).toBe('claude-opus-4-7'); // default applied
    expect(cfg.allowed_tools).toBe('Read Write Edit Bash Glob Grep');
    expect(cfg.max_budget_usd).toBe(5);
    expect(cfg.linear_team).toBeUndefined();
  });

  it('applies the default claude_model when omitted', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
${REQUIRED_TAIL}`;
    expect(parseConfig(yaml).claude_model).toBe('claude-opus-4-7');
  });

  it('respects an explicit claude_model override', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
claude_model: claude-sonnet-4-6
${REQUIRED_TAIL}`;
    expect(parseConfig(yaml).claude_model).toBe('claude-sonnet-4-6');
  });

  it('rejects a handoff_pattern that lacks {N}', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x.md
max_phase: 1
tracking_issue: 1
${REQUIRED_TAIL}`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    try {
      parseConfig(yaml);
    } catch (err) {
      expect((err as ConfigError).message).toContain('{N}');
    }
  });

  it('rejects missing required fields', () => {
    const yaml = `
project_name: X
feature_branch: main
`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
  });

  it('rejects negative or zero max_phase', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 0
tracking_issue: 1
${REQUIRED_TAIL}`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
  });

  it('rejects unknown extra keys (strict schema)', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
mystery_field: oops
${REQUIRED_TAIL}`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
  });

  it('rejects non-mapping YAML', () => {
    expect(() => parseConfig('just a string')).toThrow(ConfigError);
    expect(() => parseConfig('- a\n- b')).toThrow(ConfigError);
  });

  it('rejects malformed YAML', () => {
    expect(() => parseConfig('this: is: bad: yaml:\n  - [')).toThrow(ConfigError);
  });

  it('rejects missing allowed_tools', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
max_budget_usd: 5.00
`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    try {
      parseConfig(yaml);
    } catch (err) {
      expect((err as ConfigError).message).toContain('allowed_tools');
    }
  });

  it('rejects missing max_budget_usd', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
allowed_tools: "Read Write Edit Bash"
`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    try {
      parseConfig(yaml);
    } catch (err) {
      expect((err as ConfigError).message).toContain('max_budget_usd');
    }
  });

  it('rejects zero or negative max_budget_usd', () => {
    for (const v of [0, -1, -0.5]) {
      const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
allowed_tools: "Read Write Edit Bash"
max_budget_usd: ${v}
`;
      expect(() => parseConfig(yaml)).toThrow(ConfigError);
    }
  });

  it('rejects allowed_tools containing AskUserQuestion (would hang headless)', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
allowed_tools: "Read Write Edit Bash AskUserQuestion"
max_budget_usd: 5.00
`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    try {
      parseConfig(yaml);
    } catch (err) {
      expect((err as ConfigError).message).toContain('AskUserQuestion');
    }
  });
});
