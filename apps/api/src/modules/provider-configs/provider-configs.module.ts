import { Module } from '@nestjs/common';
import { ProviderConfigsController } from './provider-configs.controller';
import { ProviderConfigsService } from './provider-configs.service';

@Module({
  controllers: [ProviderConfigsController],
  providers: [ProviderConfigsService],
  exports: [ProviderConfigsService],
})
export class ProviderConfigsModule {}
