import { describe, expect, it } from 'vitest';
import { agentIssueWritebackSchema } from './issue-writeback';

describe('agentIssueWritebackSchema', () => {
  it('defaults all three arrays to [] when parsing {} (enabled-but-unselected)', () => {
    const result = agentIssueWritebackSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      allowedStatuses: [],
      allowedLabels: [],
      allowedPrStates: [],
    });
  });

  it('accepts the full allowedPrStates enum set', () => {
    const result = agentIssueWritebackSchema.safeParse({
      allowedPrStates: ['open', 'closed', 'draft', 'ready'],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.allowedPrStates).toEqual([
      'open',
      'closed',
      'draft',
      'ready',
    ]);
  });

  it('rejects an unknown allowedPrStates value', () => {
    const result = agentIssueWritebackSchema.safeParse({
      allowedPrStates: ['merged'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string entry in allowedStatuses (min(1))', () => {
    const result = agentIssueWritebackSchema.safeParse({
      allowedStatuses: ['Dev', ''],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string entry in allowedLabels (min(1))', () => {
    const result = agentIssueWritebackSchema.safeParse({
      allowedLabels: [''],
    });
    expect(result.success).toBe(false);
  });

  it('round-trips a fully-populated object unchanged', () => {
    const input = {
      allowedStatuses: ['Dev', 'Review', 'Done'],
      allowedLabels: ['needs-review', 'ready-to-merge'],
      allowedPrStates: ['open', 'ready'] as const,
    };
    const result = agentIssueWritebackSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(input);
  });

  it('rejects a non-array value for allowedLabels', () => {
    const result = agentIssueWritebackSchema.safeParse({
      allowedLabels: 'needs-review',
    });
    expect(result.success).toBe(false);
  });
});
