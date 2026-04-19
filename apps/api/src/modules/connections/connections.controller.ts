import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { ConnectionsService } from './connections.service';
import {
  type CreateConnectionDto,
  type UpdateConnectionDto,
  createConnectionDtoSchema,
  updateConnectionDtoSchema,
} from './dto';

/**
 * Per-workflow connections. Mounted under the workflow URL so the UI can
 * reason about them as children of a workflow (they share cascade semantics
 * too — deleting the workflow drops its connections). See
 * docs/ARCHITECTURE.md for the full route table.
 */
@UseGuards(ApiKeyGuard)
@Controller('workflows/:workflowId/connections')
export class ConnectionsController {
  constructor(private readonly svc: ConnectionsService) {}

  @Get()
  list(@Param('workflowId') workflowId: string) {
    return this.svc.list(workflowId);
  }

  @Post()
  create(
    @Param('workflowId') workflowId: string,
    @Body(new ZodBodyPipe(createConnectionDtoSchema)) dto: CreateConnectionDto,
  ) {
    return this.svc.create(workflowId, dto);
  }

  @Put(':connectionId')
  update(
    @Param('workflowId') workflowId: string,
    @Param('connectionId') connectionId: string,
    @Body(new ZodBodyPipe(updateConnectionDtoSchema)) dto: UpdateConnectionDto,
  ) {
    return this.svc.update(workflowId, connectionId, dto);
  }

  @Delete(':connectionId')
  @HttpCode(204)
  async delete(
    @Param('workflowId') workflowId: string,
    @Param('connectionId') connectionId: string,
  ) {
    await this.svc.delete(workflowId, connectionId);
  }
}
