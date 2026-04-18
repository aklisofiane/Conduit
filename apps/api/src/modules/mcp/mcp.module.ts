import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
