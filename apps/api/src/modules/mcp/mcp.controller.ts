import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard.js';
import { ZodBodyPipe } from '../../common/zod-body.pipe.js';
import { type IntrospectMcpDto, introspectMcpDtoSchema } from './dto.js';
import { McpService } from './mcp.service.js';

@UseGuards(ApiKeyGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly svc: McpService) {}

  @Post('introspect')
  introspect(@Body(new ZodBodyPipe(introspectMcpDtoSchema)) dto: IntrospectMcpDto) {
    return this.svc.introspect(dto.transport);
  }
}
