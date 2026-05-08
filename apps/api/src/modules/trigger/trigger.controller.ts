import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { OrgId } from '../../auth/org-id.decorator';
import { SessionGuard } from '../../auth/session.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import {
  type ListLabelsDto,
  type ListProjectsDto,
  listLabelsDtoSchema,
  listProjectsDtoSchema,
} from './dto';
import { TriggerService } from './trigger.service';

/**
 * Trigger-config-time helpers. No longer scoped under a workflow path —
 * connections are global, so the canvas talks to a top-level endpoint and
 * passes the connection id directly.
 */
@UseGuards(SessionGuard)
@Controller('trigger')
export class TriggerController {
  constructor(private readonly svc: TriggerService) {}

  @Post('list-projects')
  listProjects(
    @OrgId() orgId: string,
    @Body(new ZodBodyPipe(listProjectsDtoSchema)) dto: ListProjectsDto,
  ) {
    return this.svc.listProjects(orgId, dto);
  }

  @Post('list-labels')
  listLabels(
    @OrgId() orgId: string,
    @Body(new ZodBodyPipe(listLabelsDtoSchema)) dto: ListLabelsDto,
  ) {
    return this.svc.listLabels(orgId, dto);
  }
}
