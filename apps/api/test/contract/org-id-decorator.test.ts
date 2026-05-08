import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { OrgId } from '../../src/auth/org-id.decorator';

/**
 * `@OrgId()` is built with `createParamDecorator`. Nest stashes the
 * decorator factory on the parameter via `ROUTE_ARGS_METADATA` so the
 * test pulls it out and runs it against synthesized `ExecutionContext`s.
 * Keeps the assertions tight to the runtime contract — "missing active
 * org → ForbiddenException" — without booting a Nest app.
 */

class Probe {
  handler(_orgId: string): void {
    /* no-op */
  }
}
OrgId()(Probe.prototype, 'handler', 0);

const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
  string,
  { factory: (data: unknown, ctx: ExecutionContext) => unknown }
>;
const factory = Object.values(metadata)[0]!.factory;

function ctxFor(session: { activeOrganizationId?: string | null } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ session }),
    }),
  } as unknown as ExecutionContext;
}

describe('@OrgId() decorator', () => {
  it('returns the active organization id when present', () => {
    expect(factory(undefined, ctxFor({ activeOrganizationId: 'org_xyz' }))).toBe('org_xyz');
  });

  it('throws ForbiddenException when activeOrganizationId is missing', () => {
    expect(() => factory(undefined, ctxFor({}))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no session at all', () => {
    expect(() => factory(undefined, ctxFor(undefined))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when activeOrganizationId is null', () => {
    expect(() => factory(undefined, ctxFor({ activeOrganizationId: null }))).toThrow(
      ForbiddenException,
    );
  });
});
