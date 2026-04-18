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
import { ApiKeyGuard } from '../../common/api-key.guard.js';
import { ZodBodyPipe } from '../../common/zod-body.pipe.js';
import { CredentialsService } from './credentials.service.js';
import {
  type CreateCredentialDto,
  type UpdateCredentialDto,
  createCredentialDtoSchema,
  updateCredentialDtoSchema,
} from './dto.js';

@UseGuards(ApiKeyGuard)
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly svc: CredentialsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body(new ZodBodyPipe(createCredentialDtoSchema)) dto: CreateCredentialDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateCredentialDtoSchema)) dto: UpdateCredentialDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string) {
    await this.svc.delete(id);
  }
}
