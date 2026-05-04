import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { TriggerController } from './trigger.controller';
import { TriggerService } from './trigger.service';

@Module({
  imports: [CredentialsModule],
  controllers: [TriggerController],
  providers: [TriggerService],
})
export class TriggerModule {}
