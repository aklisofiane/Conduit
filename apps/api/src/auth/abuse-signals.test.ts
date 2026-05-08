import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbuseSignalsService } from './abuse-signals';

/**
 * Threshold boundary cases for the failed-login-spike check. The rule is
 * `count > 10` — exactly 10 in the window MUST NOT trigger (typical
 * scripting brute-force grace), 11+ MUST trigger one warn line.
 */
describe('AbuseSignalsService.checkFailedLoginSpike', () => {
  let warnSpy: ReturnType<typeof vi.fn>;

  function makeService(count: number): AbuseSignalsService {
    const fakePrisma = {
      auditLog: { count: vi.fn().mockResolvedValue(count) },
    };
    return new AbuseSignalsService(fakePrisma as never);
  }

  beforeEach(() => {
    warnSpy = vi.fn();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(warnSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing at 9 failures (under threshold)', async () => {
    const svc = makeService(9);
    await svc.checkFailedLoginSpike({ actorEmail: 'a@b.com' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does nothing at exactly 10 failures (boundary — threshold is strict gt)', async () => {
    const svc = makeService(10);
    await svc.checkFailedLoginSpike({ actorEmail: 'a@b.com' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits one warn line at 11 failures', async () => {
    const svc = makeService(11);
    await svc.checkFailedLoginSpike({ actorEmail: 'a@b.com' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('abuse.failedLoginSpike');
    expect(msg).toContain('a@b.com');
    expect(msg).toContain('count=11');
    expect(msg).toContain('windowMinutes=5');
  });

  it('queries auditLog with the right filter shape', async () => {
    const countSpy = vi.fn().mockResolvedValue(0);
    const fakePrisma = { auditLog: { count: countSpy } };
    const svc = new AbuseSignalsService(fakePrisma as never);
    const before = Date.now();
    await svc.checkFailedLoginSpike({ actorEmail: 'spam@example.com' });
    const after = Date.now();

    expect(countSpy).toHaveBeenCalledTimes(1);
    const arg = countSpy.mock.calls[0]![0];
    expect(arg.where.event).toBe('auth.signIn.failed');
    expect(arg.where.actorEmail).toBe('spam@example.com');
    const sinceMs = (arg.where.createdAt.gte as Date).getTime();
    // ~5 min ago at call time, allow a wide tolerance for slow CI.
    expect(sinceMs).toBeGreaterThanOrEqual(before - 5 * 60 * 1000 - 50);
    expect(sinceMs).toBeLessThanOrEqual(after - 5 * 60 * 1000 + 50);
  });
});
