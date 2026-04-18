import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { RedisModule } from './redis/redis.module.js';
import { TemporalModule } from './temporal/temporal.module.js';
import { CredentialsModule } from './modules/credentials/credentials.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { McpModule } from './modules/mcp/mcp.module.js';
import { RunsModule } from './modules/runs/runs.module.js';
import { SkillsModule } from './modules/skills/skills.module.js';
import { WorkflowsModule } from './modules/workflows/workflows.module.js';

@Module({
  imports: [
    CommonModule,
    RedisModule,
    TemporalModule,
    HealthModule,
    WorkflowsModule,
    RunsModule,
    CredentialsModule,
    SkillsModule,
    McpModule,
  ],
})
export class AppModule {}
