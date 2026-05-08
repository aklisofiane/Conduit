import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@conduit/database';
import { AuditLogService } from './audit-log.service';

/**
 * Pure unit test against a fake `prisma.auditLog.create` — verifies the
 * service maps `record({...})` onto the create payload Prisma expects, and
 * that absent optional fields land as null (not `undefined`).
 */
describe('AuditLogService.record', () => {
  function makeService(): {
    svc: AuditLogService;
    spy: ReturnType<typeof vi.fn>;
  } {
    const spy = vi.fn().mockResolvedValue({});
    const fakePrisma = { auditLog: { create: spy } };
    const svc = new AuditLogService(fakePrisma as never);
    return { svc, spy };
  }

  it('maps a fully populated record to the create payload', async () => {
    const { svc, spy } = makeService();
    await svc.record({
      event: 'auth.signIn',
      actorUserId: 'user_1',
      actorEmail: 'a@b.com',
      actorIp: '203.0.113.1',
      orgId: 'org_1',
      targetUserId: 'user_2',
      metadata: { provider: 'email' },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual({
      data: {
        event: 'auth.signIn',
        actorUserId: 'user_1',
        actorEmail: 'a@b.com',
        actorIp: '203.0.113.1',
        orgId: 'org_1',
        targetUserId: 'user_2',
        metadata: { provider: 'email' },
      },
    });
  });

  it('coerces missing optional fields to null and metadata to JsonNull', async () => {
    const { svc, spy } = makeService();
    await svc.record({ event: 'auth.signIn.failed' });
    expect(spy).toHaveBeenCalledWith({
      data: {
        event: 'auth.signIn.failed',
        actorUserId: null,
        actorEmail: null,
        actorIp: null,
        orgId: null,
        targetUserId: null,
        metadata: Prisma.JsonNull,
      },
    });
  });

  it('preserves explicitly-null actor fields', async () => {
    const { svc, spy } = makeService();
    await svc.record({
      event: 'auth.signIn.failed',
      actorEmail: 'a@b.com',
      actorUserId: null,
      actorIp: null,
    });
    const data = spy.mock.calls[0]![0].data;
    expect(data.actorUserId).toBeNull();
    expect(data.actorEmail).toBe('a@b.com');
    expect(data.actorIp).toBeNull();
  });
});
