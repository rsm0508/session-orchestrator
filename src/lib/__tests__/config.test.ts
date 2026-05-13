import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../config.js';

describe('parseConfig', () => {
  it('parses a valid minimal config', () => {
    const yaml = `
project_name: MCP v1.0
feature_branch: feat/mcp-v1
handoff_pattern: docs/handoffs/mcp-phase-{N}-kickoff.md
max_phase: 4
tracking_issue: 1
`;
    const cfg = parseConfig(yaml);
    expect(cfg.project_name).toBe('MCP v1.0');
    expect(cfg.feature_branch).toBe('feat/mcp-v1');
    expect(cfg.max_phase).toBe(4);
    expect(cfg.claude_model).toBe('claude-opus-4-7'); // default applied
    expect(cfg.linear_team).toBeUndefined();
  });

  it('applies the default claude_model when omitted', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x-{N}.md
max_phase: 1
tracking_issue: 1
`;
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
`;
    expect(parseConfig(yaml).claude_model).toBe('claude-sonnet-4-6');
  });

  it('rejects a handoff_pattern that lacks {N}', () => {
    const yaml = `
project_name: X
feature_branch: main
handoff_pattern: docs/handoffs/x.md
max_phase: 1
tracking_issue: 1
`;
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
`;
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
`;
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
  });

  it('rejects non-mapping YAML', () => {
    expect(() => parseConfig('just a string')).toThrow(ConfigError);
    expect(() => parseConfig('- a\n- b')).toThrow(ConfigError);
  });

  it('rejects malformed YAML', () => {
    expect(() => parseConfig('this: is: bad: yaml:\n  - [')).toThrow(ConfigError);
  });
});
