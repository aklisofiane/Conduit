import { afterEach, describe, expect, it } from 'vitest';
import { githubAuthHeaders, githubGraphqlUrl, githubRestUrl } from './http';

describe('githubGraphqlUrl', () => {
  const original = process.env.GITHUB_GRAPHQL_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_GRAPHQL_URL;
    else process.env.GITHUB_GRAPHQL_URL = original;
  });

  it('defaults to the cloud GraphQL endpoint when GITHUB_GRAPHQL_URL is unset', () => {
    delete process.env.GITHUB_GRAPHQL_URL;
    expect(githubGraphqlUrl()).toBe('https://api.github.com/graphql');
  });

  it('honors the GITHUB_GRAPHQL_URL override', () => {
    process.env.GITHUB_GRAPHQL_URL = 'https://ghe.acme.io/api/graphql';
    expect(githubGraphqlUrl()).toBe('https://ghe.acme.io/api/graphql');
  });
});

describe('githubRestUrl', () => {
  const original = process.env.GITHUB_REST_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_REST_URL;
    else process.env.GITHUB_REST_URL = original;
  });

  it('defaults to the cloud REST base when GITHUB_REST_URL is unset', () => {
    delete process.env.GITHUB_REST_URL;
    expect(githubRestUrl()).toBe('https://api.github.com');
  });

  it('honors the GITHUB_REST_URL override', () => {
    process.env.GITHUB_REST_URL = 'https://ghe.acme.io/api/v3';
    expect(githubRestUrl()).toBe('https://ghe.acme.io/api/v3');
  });
});

describe('githubAuthHeaders', () => {
  it('sets the bearer token, a stable user agent, and the GitHub Accept header', () => {
    expect(githubAuthHeaders('tok-123')).toEqual({
      Authorization: 'Bearer tok-123',
      'User-Agent': 'conduit-poll/0.1',
      Accept: 'application/vnd.github+json',
    });
  });
});
