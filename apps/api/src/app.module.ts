import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { RedisModule } from './redis/redis.module';
import { TemporalModule } from './temporal/temporal.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { HealthModule } from './modules/health/health.module';
import { McpModule } from './modules/mcp/mcp.module';
import { ModelPricingModule } from './modules/model-pricing/model-pricing.module';
import { ProviderConfigsModule } from './modules/provider-configs/provider-configs.module';
import { RunsModule } from './modules/runs/runs.module';
import { SkillsModule } from './modules/skills/skills.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AgentPresetsModule } from './modules/agent-presets/agent-presets.module';
import { TriggerModule } from './modules/trigger/trigger.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';

@Module({
  imports: [
    AuthModule,
    CommonModule,
    RedisModule,
    TemporalModule,
    HealthModule,
    WorkflowsModule,
    RunsModule,
    CredentialsModule,
    ConnectionsModule,
    ProviderConfigsModule,
    ModelPricingModule,
    SkillsModule,
    McpModule,
    TemplatesModule,
    AgentPresetsModule,
    TriggerModule,
    WebhooksModule,
  ],
})
export class AppModule {}
