import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { TriggerController } from './trigger.controller';
import { TriggerService } from './trigger.service';

@Module({
  imports: [ConnectionsModule, CredentialsModule],
  controllers: [TriggerController],
  providers: [TriggerService],
})
export class TriggerModule {}
