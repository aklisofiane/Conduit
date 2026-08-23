import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { OrgId } from '../../auth/org-id.decorator';
import { SessionGuard } from '../../auth/session.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { type UpsertModelPriceDto, upsertModelPriceDtoSchema } from './dto';
import { ModelPricingService } from './model-pricing.service';

@UseGuards(SessionGuard)
@Controller('model-pricing')
export class ModelPricingController {
  constructor(private readonly svc: ModelPricingService) {}

  @Get()
  list(@OrgId() orgId: string) {
    return this.svc.list(orgId);
  }

  @Put()
  upsert(
    @OrgId() orgId: string,
    @Body(new ZodBodyPipe(upsertModelPriceDtoSchema))
    dto: UpsertModelPriceDto,
  ) {
    return this.svc.upsert(orgId, dto);
  }

  @Delete(':model')
  @HttpCode(204)
  async delete(@OrgId() orgId: string, @Param('model') model: string) {
    await this.svc.delete(orgId, model);
  }
}
