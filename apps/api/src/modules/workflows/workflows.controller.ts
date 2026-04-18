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
import {
  type CreateWorkflowDto,
  type ManualRunDto,
  type UpdateWorkflowDto,
  createWorkflowDtoSchema,
  manualRunDtoSchema,
  updateWorkflowDtoSchema,
} from './dto';
import { WorkflowsService } from './workflows.service';

@UseGuards(ApiKeyGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly svc: WorkflowsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body(new ZodBodyPipe(createWorkflowDtoSchema)) dto: CreateWorkflowDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateWorkflowDtoSchema)) dto: UpdateWorkflowDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string) {
    await this.svc.delete(id);
  }

  @Post(':id/run')
  run(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(manualRunDtoSchema)) dto: ManualRunDto,
  ) {
    return this.svc.manualRun(id, dto);
  }
}
