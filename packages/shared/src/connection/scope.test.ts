import { describe, expect, it } from 'vitest';
import { connectionScopeSchema, expectScopeKind, type ConnectionScope } from './scope';

describe('connectionScopeSchema', () => {
  it('accepts a github_repo scope', () => {
    const result = connectionScopeSchema.safeParse({
      kind: 'github_repo',
      owner: 'acme',
      repo: 'shop',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a github_projects_v2 scope', () => {
    const result = connectionScopeSchema.safeParse({
      kind: 'github_projects_v2',
      ownerType: 'org',
      owner: 'acme',
      number: 5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a none scope', () => {
    expect(connectionScopeSchema.safeParse({ kind: 'none' }).success).toBe(true);
  });

  it('rejects an unknown discriminator', () => {
    expect(connectionScopeSchema.safeParse({ kind: 'slack_workspace' }).success).toBe(false);
  });

  it('rejects a github_repo scope missing repo', () => {
    expect(
      connectionScopeSchema.safeParse({
        kind: 'github_repo',
        owner: 'acme',
      }).success,
    ).toBe(false);
  });

  it('rejects a github_projects_v2 scope with a non-positive number', () => {
    expect(
      connectionScopeSchema.safeParse({
        kind: 'github_projects_v2',
        ownerType: 'org',
        owner: 'acme',
        number: 0,
      }).success,
    ).toBe(false);
  });
});

describe('expectScopeKind', () => {
  const repo: ConnectionScope = { kind: 'github_repo', owner: 'a', repo: 'b' };
  const board: ConnectionScope = {
    kind: 'github_projects_v2',
    ownerType: 'org',
    owner: 'a',
    number: 1,
  };

  it('narrows when the kind matches', () => {
    const narrowed = expectScopeKind(repo, 'github_repo');
    expect(narrowed.owner).toBe('a');
    expect(narrowed.repo).toBe('b');
  });

  it('throws a clean error when the kind does not match', () => {
    expect(() => expectScopeKind(board, 'github_repo')).toThrow(
      /Expected connection scope kind "github_repo"/,
    );
  });
});
