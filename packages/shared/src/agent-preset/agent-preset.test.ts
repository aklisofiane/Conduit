import { describe, expect, it } from 'vitest';
import { agentPresetFileSchema, type AgentPresetFile } from './index';

const VALID: AgentPresetFile = {
  id: 'developer',
  name: 'Developer',
  description: 'Implements code from a plan in .conduit/',
  category: 'implement',
  provider: 'claude',
  model: 'claude-opus-4-6',
  instructions: 'You are the Developer agent…',
};

describe('agentPresetFileSchema', () => {
  it('accepts a minimal valid preset', () => {
    expect(agentPresetFileSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts a preset with suggestedConstraints', () => {
    const result = agentPresetFileSchema.safeParse({
      ...VALID,
      suggestedConstraints: { maxTurns: 40, timeoutSec: 1800 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-kebab-case id', () => {
    const result = agentPresetFileSchema.safeParse({ ...VALID, id: 'Developer' });
    expect(result.success).toBe(false);
  });

  it('rejects empty instructions', () => {
    const result = agentPresetFileSchema.safeParse({ ...VALID, instructions: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = agentPresetFileSchema.safeParse({ ...VALID, category: 'misc' });
    expect(result.success).toBe(false);
  });
});
