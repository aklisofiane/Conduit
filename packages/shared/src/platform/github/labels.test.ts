import { describe, expect, it } from 'vitest';
import { createRepoLabel } from './labels';

describe('createRepoLabel', () => {
  it('POSTs name/color/description and returns "created" on 2xx', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch: typeof fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ name: 'conduit-dev' }), {
        status: 201,
      });
    }) as typeof fetch;

    const status = await createRepoLabel(
      {
        owner: 'acme',
        repo: 'api',
        token: 't',
        name: 'conduit-dev',
        color: '1f6feb',
        description: 'hand off to develop',
      },
      fakeFetch,
    );

    expect(status).toBe('created');
    expect(captured!.url).toBe('https://api.github.com/repos/acme/api/labels');
    expect(captured!.init.method).toBe('POST');
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      name: 'conduit-dev',
      color: '1f6feb',
      description: 'hand off to develop',
    });
  });

  it('treats a 422 already_exists as "exists" (ensure semantics)', async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          message: 'Validation Failed',
          errors: [{ resource: 'Label', code: 'already_exists', field: 'name' }],
        }),
        { status: 422 },
      )) as typeof fetch;

    const status = await createRepoLabel(
      { owner: 'acme', repo: 'api', token: 't', name: 'conduit-dev', color: '1f6feb' },
      fakeFetch,
    );
    expect(status).toBe('exists');
  });

  it('throws on a 422 that is not already_exists', async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          message: 'Validation Failed',
          errors: [{ resource: 'Label', code: 'invalid', field: 'color' }],
        }),
        { status: 422 },
      )) as typeof fetch;

    await expect(
      createRepoLabel(
        { owner: 'acme', repo: 'api', token: 't', name: 'conduit-dev', color: 'zzz' },
        fakeFetch,
      ),
    ).rejects.toThrow(/GitHub REST HTTP 422/);
  });

  it('throws on other non-2xx (e.g. 403 read-only token)', async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response('Forbidden', { status: 403 })) as typeof fetch;

    await expect(
      createRepoLabel(
        { owner: 'acme', repo: 'api', token: 't', name: 'conduit-dev', color: '1f6feb' },
        fakeFetch,
      ),
    ).rejects.toThrow(/GitHub REST HTTP 403 creating label "conduit-dev" for acme\/api/);
  });

  it('defaults description to empty string when omitted', async () => {
    let body: string | undefined;
    const fakeFetch: typeof fetch = (async (_url: string, init: RequestInit) => {
      body = init.body as string;
      return new Response('{}', { status: 201 });
    }) as typeof fetch;

    await createRepoLabel(
      { owner: 'acme', repo: 'api', token: 't', name: 'conduit-dev', color: '1f6feb' },
      fakeFetch,
    );
    expect(JSON.parse(body!).description).toBe('');
  });
});
