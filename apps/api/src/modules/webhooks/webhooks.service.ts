import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { matchesTrigger, type WorkflowDefinition } from '@conduit/shared';
import {
  normalizeGithubWebhook,
  normalizeGitlabWebhook,
  verifyGithubSignature,
  verifyGitlabToken,
} from '@conduit/shared/webhook';
import { PrismaService } from '../../common/prisma.service';
import { safeDecrypt } from '../credentials/crypto';
import { WorkflowsService } from '../workflows/workflows.service';

export interface WebhookResult {
  status: 'started' | 'filtered' | 'unsupported' | 'duplicate-dropped';
  runId?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly devSecret = process.env.WEBHOOK_DEV_SECRET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async handle(workflowId: string, req: RawBodyRequest): Promise<WebhookResult> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        orgId: true,
        isActive: true,
        webhookSecret: true,
        definition: true,
      },
    });
    if (!workflow) throw new NotFoundException(`Workflow ${workflowId} not found`);

    const definition = workflow.definition as WorkflowDefinition | null;
    const trigger = definition?.triggers?.[0];
    if (!trigger || (trigger.platform !== 'github' && trigger.platform !== 'gitlab')) {
      throw new UnauthorizedException(
        `Workflow ${workflowId} is not configured for webhook delivery`,
      );
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body missing on webhook request — check main.ts body parser setup');
      throw new UnauthorizedException('Webhook body could not be verified');
    }

    const platform = trigger.platform;
    let verified: boolean;
    let eventName: string | undefined;

    if (platform === 'github') {
      const signatureHeader = headerString(req.headers['x-hub-signature-256']);
      verified = this.verifyGithub(workflow.webhookSecret, rawBody, signatureHeader);
      eventName = headerString(req.headers['x-github-event']);
      if (verified && !eventName) {
        throw new UnauthorizedException('Missing X-GitHub-Event header');
      }
    } else {
      const tokenHeader = headerString(req.headers['x-gitlab-token']);
      verified = this.verifyGitlab(workflow.webhookSecret, tokenHeader);
      eventName = headerString(req.headers['x-gitlab-event']);
      if (verified && !eventName) {
        throw new UnauthorizedException('Missing X-Gitlab-Event header');
      }
    }

    if (!verified) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const triggerEvent =
      platform === 'github'
        ? normalizeGithubWebhook(eventName!, req.body)
        : normalizeGitlabWebhook(eventName!, req.body);

    if (!triggerEvent) {
      this.logger.debug(`Unsupported ${platform} event ${eventName} — dropping delivery`);
      return { status: 'unsupported' };
    }

    if (!matchesTrigger(triggerEvent, trigger)) {
      this.logger.debug(
        `${platform} ${eventName} did not match filters for workflow ${workflowId}`,
      );
      return { status: 'filtered' };
    }

    if (!workflow.isActive) {
      this.logger.debug(`Workflow ${workflowId} is inactive — dropping matched delivery`);
      return { status: 'filtered' };
    }

    const run = await this.workflows.startRun(workflow.orgId, workflowId, triggerEvent);
    if (!run) {
      return { status: 'duplicate-dropped' };
    }
    return { status: 'started', runId: run.id };
  }

  private verifyGithub(
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

  private verifyGitlab(encryptedSecret: string | null, header: string | undefined): boolean {
    if (this.devSecret && header && header === this.devSecret) return true;
    if (!encryptedSecret || !header) return false;
    const secret = safeDecrypt(encryptedSecret);
    if (!secret) return false;
    return verifyGitlabToken(secret, header);
  }
}

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

function headerString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
