import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { OrgId } from '../../auth/org-id.decorator';
import { SessionGuard } from '../../auth/session.guard';
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
 *
 * Catalog endpoints (`list`, `get`) read Conduit-shipped global content and
 * are not org-scoped. `createFromTemplate` mutates DB state for the active
 * org so it forwards `@OrgId()` to the service.
 */
@UseGuards(SessionGuard)
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
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(createFromTemplateDtoSchema)) dto: CreateFromTemplateDto,
  ) {
    return this.svc.createFromTemplate(orgId, id, dto);
  }
}
