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
  type CreateProviderConfigDto,
  type UpdateProviderConfigDto,
  createProviderConfigDtoSchema,
  updateProviderConfigDtoSchema,
} from './dto';
import { ProviderConfigsService } from './provider-configs.service';

@UseGuards(SessionGuard)
@Controller('provider-configs')
export class ProviderConfigsController {
  constructor(private readonly svc: ProviderConfigsService) {}

  @Get()
  list(@OrgId() orgId: string) {
    return this.svc.list(orgId);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @Body(new ZodBodyPipe(createProviderConfigDtoSchema))
    dto: CreateProviderConfigDto,
  ) {
    return this.svc.create(orgId, dto);
  }

  @Put(':id')
  update(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateProviderConfigDtoSchema))
    dto: UpdateProviderConfigDto,
  ) {
    return this.svc.update(orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@OrgId() orgId: string, @Param('id') id: string) {
    await this.svc.delete(orgId, id);
  }
}
