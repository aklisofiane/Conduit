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
import { OrgId } from '../../auth/org-id.decorator';
import { SessionGuard } from '../../auth/session.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import {
  type CreateWorkflowDto,
  type SetWebhookSecretDto,
  type UpdateWorkflowDto,
  createWorkflowDtoSchema,
  setWebhookSecretDtoSchema,
  updateWorkflowDtoSchema,
} from './dto';
import { WorkflowsService } from './workflows.service';

@UseGuards(SessionGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly svc: WorkflowsService) {}

  @Get()
  list(@OrgId() orgId: string) {
    return this.svc.list(orgId);
  }

  @Get(':id')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.svc.get(orgId, id);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @Body(new ZodBodyPipe(createWorkflowDtoSchema)) dto: CreateWorkflowDto,
  ) {
    return this.svc.create(orgId, dto);
  }

  @Put(':id')
  update(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateWorkflowDtoSchema)) dto: UpdateWorkflowDto,
  ) {
    return this.svc.update(orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@OrgId() orgId: string, @Param('id') id: string) {
    await this.svc.delete(orgId, id);
  }

  @Post(':id/duplicate')
  duplicate(@OrgId() orgId: string, @Param('id') id: string) {
    return this.svc.duplicate(orgId, id);
  }

  @Put(':id/webhook-secret')
  setWebhookSecret(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(setWebhookSecretDtoSchema)) dto: SetWebhookSecretDto,
  ) {
    return this.svc.setWebhookSecret(orgId, id, dto.secret);
  }

  @Delete(':id/webhook-secret')
  @HttpCode(204)
  async clearWebhookSecret(@OrgId() orgId: string, @Param('id') id: string) {
    await this.svc.clearWebhookSecret(orgId, id);
  }
}
