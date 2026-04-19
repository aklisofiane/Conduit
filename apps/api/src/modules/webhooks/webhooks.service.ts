import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { matchesTrigger, type WorkflowDefinition } from '@conduit/shared';
import { normalizeGithubWebhook, verifyGithubSignature } from '@conduit/shared/webhook';
import { PrismaService } from '../../common/prisma.service';
import { safeDecrypt } from '../credentials/crypto';
import { WorkflowsService } from '../workflows/workflows.service';

export interface WebhookResult {
  status: 'started' | 'filtered' | 'unsupported' | 'duplicate-dropped';
  runId?: string;
}

/**
 * Webhook ingestion. Verifies the HMAC signature against the connection's
 * stored `webhookSecret`, normalizes the platform payload into a
 * `TriggerEvent`, applies trigger filters, and — on match — starts a run via
 * `WorkflowsService.startRun`. Keeps business logic off the controller so
 * the same path can be exercised from contract tests later.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly devSecret = process.env.WEBHOOK_DEV_SECRET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async handleGithub(workflowId: string, req: RawBodyRequest): Promise<WebhookResult> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { connections: true },
    });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);

    const definition = workflow.definition as WorkflowDefinition | null;
    const trigger = definition?.trigger;
    if (!trigger || trigger.platform !== 'github') {
      throw new UnauthorizedException(
        `Workflow ${workflowId} is not configured for GitHub webhooks`,
      );
    }

    // Credential lookup: the trigger's connectionId identifies which
    // connection's signing secret to use. We never fall back across
    // connections — a mismatched secret must fail auth, not silently pass.
    const connection = workflow.connections.find((c) => c.id === trigger.connectionId);
    if (!connection) {
      throw new UnauthorizedException(
        `Workflow ${workflowId} trigger references unknown connection ${trigger.connectionId}`,
      );
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body missing on webhook request — check main.ts body parser setup');
      throw new UnauthorizedException('Webhook body could not be verified');
    }

    const signatureHeader = headerString(req.headers['x-hub-signature-256']);
    if (!this.verify(connection.webhookSecret, rawBody, signatureHeader)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const eventName = headerString(req.headers['x-github-event']);
    if (!eventName) {
      throw new UnauthorizedException('Missing X-GitHub-Event header');
    }

    const triggerEvent = normalizeGithubWebhook(eventName, req.body);
    if (!triggerEvent) {
      this.logger.debug(`Unsupported GitHub event ${eventName} — dropping delivery`);
      return { status: 'unsupported' };
    }

    if (!matchesTrigger(triggerEvent, trigger)) {
      this.logger.debug(
        `GitHub ${eventName} did not match filters for workflow ${workflowId}`,
      );
      return { status: 'filtered' };
    }

    if (!workflow.isActive) {
      this.logger.debug(`Workflow ${workflowId} is inactive — dropping matched delivery`);
      return { status: 'filtered' };
    }

    const run = await this.workflows.startRun(workflowId, triggerEvent);
    if (!run) {
      // ticket-branch workflow already running on this ticket — swallow the
      // trigger so GitHub doesn't retry. See DuplicateRunError in the
      // TemporalService and docs/design-docs/branch-management.md.
      return { status: 'duplicate-dropped' };
    }
    return { status: 'started', runId: run.id };
  }

  /**
   * Signature-verify with a dev escape hatch: when `WEBHOOK_DEV_SECRET` is
   * set and matches the raw `X-Hub-Signature-256` header verbatim, skip
   * HMAC. Intended for local loopback testing against `gh webhook forward`.
   * Startup check in main.ts refuses to set this in production.
   */
  private verify(
    encryptedSecret: string | null,
    rawBody: Buffer,
    header: string | undefined,
  ): boolean {
    if (this.devSecret && header && header === this.devSecret) return true;
    if (!encryptedSecret || !header) return false;
    const secret = safeDecrypt(encryptedSecret);
    if (!secret) return false;
    return verifyGithubSignature(secret, rawBody, header);
  }
}

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

function headerString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
