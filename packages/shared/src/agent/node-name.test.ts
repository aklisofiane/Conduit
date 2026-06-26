import { describe, expect, it } from 'vitest';
import { NODE_NAME_PATTERN, nodeNameSchema } from './node-name';

describe('nodeNameSchema', () => {
  it('accepts valid identifiers (letter/underscore start, alnum/underscore body)', () => {
    for (const name of ['Worker', '_scratch', 'Node_1', 'A1']) {
      expect(nodeNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('rejects a leading digit', () => {
    expect(nodeNameSchema.safeParse('1Node').success).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(nodeNameSchema.safeParse('').success).toBe(false);
  });

  it('rejects names containing spaces, hyphens, or slashes', () => {
    for (const name of ['My Node', 'my-node', 'a/b']) {
      expect(nodeNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it('rejects names with other punctuation or unicode', () => {
    for (const name of ['node!', 'café']) {
      expect(nodeNameSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe('NODE_NAME_PATTERN', () => {
  it('agrees with nodeNameSchema.safeParse for every case', () => {
    const cases = [
      'Worker',
      '_scratch',
      'Node_1',
      'A1',
      '1Node',
      '',
      'My Node',
      'my-node',
      'a/b',
      'node!',
      'café',
    ];
    for (const name of cases) {
      expect(NODE_NAME_PATTERN.test(name)).toBe(nodeNameSchema.safeParse(name).success);
    }
  });
});
