import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { TemplatesService } from './templates.service';
import {
  createFromTemplateDtoSchema,
  type CreateFromTemplateDto,
} from './dto';

/**
 * Template catalog + instantiation. Templates live as static JSON in
 * `/templates/*.json` at the repo root and are loaded at boot — see
 * docs/design-docs/templates.md.
 */
@UseGuards(ApiKeyGuard)
@Controller()
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get('templates')
  list() {
    return this.svc.list();
  }

  @Get('templates/:id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post('workflows/from-template/:id')
  create(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(createFromTemplateDtoSchema)) dto: CreateFromTemplateDto,
  ) {
    return this.svc.createFromTemplate(id, dto);
  }
}
