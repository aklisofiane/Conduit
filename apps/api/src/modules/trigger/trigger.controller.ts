import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import {
  type ListLabelsDto,
  type ListProjectsDto,
  listLabelsDtoSchema,
  listProjectsDtoSchema,
} from './dto';
import { TriggerService } from './trigger.service';

@UseGuards(ApiKeyGuard)
@Controller('workflows/:workflowId/trigger')
export class TriggerController {
  constructor(private readonly svc: TriggerService) {}

  @Post('list-projects')
  listProjects(
    @Param('workflowId') workflowId: string,
    @Body(new ZodBodyPipe(listProjectsDtoSchema)) dto: ListProjectsDto,
  ) {
    return this.svc.listProjects(workflowId, dto);
  }

  @Post('list-labels')
  listLabels(
    @Param('workflowId') workflowId: string,
    @Body(new ZodBodyPipe(listLabelsDtoSchema)) dto: ListLabelsDto,
  ) {
    return this.svc.listLabels(workflowId, dto);
  }
}
