import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@conduit/database';
import type { PrismaService } from '../common/prisma.service';
import type { AuditEvent } from './audit-events';

type PrismaForAudit = Pick<PrismaClient, 'auditLog'>;

export interface AuditLogRecord {
  event: AuditEvent;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorIp?: string | null;
  orgId?: string | null;
  targetUserId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

/**
 * Single-purpose writer for security-relevant events. No `query` / `list`
 * surface in v1 — operators query the table directly (no UI, no admin
 * route). The narrow API keeps caller code on the rails: every event is
 * one of the closed taxonomy and every optional field is null-safe.
 */
@Injectable()
export class AuditLogService {
  // Accept any `PrismaClient`-shaped object so Better Auth hooks can use the
  // singleton `prisma` from `@conduit/database` while the Nest provider uses
  // the lifecycle-managed `PrismaService`.
  constructor(private readonly prisma: PrismaForAudit | PrismaService) {}

  async record(record: AuditLogRecord): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        event: record.event,
        actorUserId: record.actorUserId ?? null,
        actorEmail: record.actorEmail ?? null,
        actorIp: record.actorIp ?? null,
        orgId: record.orgId ?? null,
        targetUserId: record.targetUserId ?? null,
        // Prisma's Json column is happy with null or any JSON value; we coerce
        // an absent field to Prisma's `JsonNull` sentinel so the column lands
        // as SQL NULL rather than the JSON literal `null`.
        metadata: record.metadata ?? Prisma.JsonNull,
      },
    });
  }
}
