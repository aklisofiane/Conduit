import { Global, Module } from '@nestjs/common';
import { TemporalService } from './temporal.service.js';

@Global()
@Module({
  providers: [TemporalService],
  exports: [TemporalService],
})
export class TemporalModule {}
