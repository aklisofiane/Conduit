import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [CredentialsModule, WorkflowsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
