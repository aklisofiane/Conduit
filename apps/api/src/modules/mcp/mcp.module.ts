import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [CredentialsModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
