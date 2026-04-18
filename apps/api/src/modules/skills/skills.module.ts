import { Module } from '@nestjs/common';
import { SkillsController } from './skills.controller.js';

@Module({
  controllers: [SkillsController],
})
export class SkillsModule {}
