import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import type { PrismaService } from '../common/prisma.service';

type PrismaForAbuse = Pick<PrismaClient, 'auditLog'>;

/**
 * Threshold and window are constants in code, NOT env-tunable. A security
 * knob without experience-driven defaults is a footgun, and a one-line patch
 * is sufficient if real traffic shows false-positives.
 *
 * The threshold sits *just above* the per-IP rate-limit cap on `/sign-in/email`
 * (10 / 5 min in hosted mode). Tripping it implies the attacker is rotating
 * IPs against a single email — the case rate-limit alone can't surface.
 */
const FAILED_LOGIN_SPIKE_THRESHOLD = 10;
const FAILED_LOGIN_SPIKE_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class AbuseSignalsService {
  private readonly logger = new Logger(AbuseSignalsService.name);

  constructor(private readonly prisma: PrismaForAbuse | PrismaService) {}

  /**
   * Counts `auth.signIn.failed` rows for the given email within the spike
   * window, emitting one structured `logger.warn` line when the count
   * exceeds the threshold. v1 detects, doesn't react: no auto-block, no
   * external alert, no rate-limit escalation.
   */
  async checkFailedLoginSpike(input: { actorEmail: string }): Promise<void> {
    const since = new Date(Date.now() - FAILED_LOGIN_SPIKE_WINDOW_MS);
    const count = await this.prisma.auditLog.count({
      where: {
        event: 'auth.signIn.failed',
        actorEmail: input.actorEmail,
        createdAt: { gte: since },
      },
    });
    if (count > FAILED_LOGIN_SPIKE_THRESHOLD) {
      const windowMinutes = FAILED_LOGIN_SPIKE_WINDOW_MS / 60_000;
      this.logger.warn(
        `abuse.failedLoginSpike email=${input.actorEmail} count=${count} windowMinutes=${windowMinutes}`,
      );
    }
  }
}
