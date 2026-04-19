import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  type RawBodyRequest,
  type WebhookResult,
  WebhooksService,
} from './webhooks.service';

/**
 * Inbound webhooks. Deliberately NOT guarded by ApiKeyGuard — the platform
 * doesn't carry an API key. Authentication is HMAC-SHA256 over the raw
 * request body (see WebhooksService.verify and docs/SECURITY.md).
 *
 * Responses:
 *   - 200 started    → a run was kicked off
 *   - 200 filtered   → signature valid but filters / active flag excluded it
 *   - 200 unsupported → signature valid but we don't normalize this event type
 *   - 401            → signature missing/invalid, or workflow mis-configured
 *   - 404            → workflow does not exist
 *
 * Everything is 200 when auth passes so the platform doesn't retry on soft
 * drops — GitHub retries on non-2xx and we'd re-drop the same delivery.
 */
@Controller('hooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Post(':workflowId')
  @HttpCode(200)
  async github(
    @Param('workflowId') workflowId: string,
    @Req() req: RawBodyRequest,
  ): Promise<WebhookResult> {
    return this.svc.handleGithub(workflowId, req);
  }
}
