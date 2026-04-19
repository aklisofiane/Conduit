import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RedisModule } from './redis/redis.module';
import { TemporalModule } from './temporal/temporal.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { HealthModule } from './modules/health/health.module';
import { McpModule } from './modules/mcp/mcp.module';
import { RunsModule } from './modules/runs/runs.module';
import { SkillsModule } from './modules/skills/skills.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

@Module({
  imports: [
    CommonModule,
    RedisModule,
    TemporalModule,
    HealthModule,
    WorkflowsModule,
    RunsModule,
    CredentialsModule,
    ConnectionsModule,
    SkillsModule,
    McpModule,
    TemplatesModule,
    WebhooksModule,
  ],
})
export class AppModule {}
