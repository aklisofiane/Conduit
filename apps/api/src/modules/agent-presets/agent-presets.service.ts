import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AgentPreset } from '@conduit/shared';
import { orNotFound } from '../../common/or-not-found';
import { loadAgentPresets } from './agent-preset-loader';

@Injectable()
export class AgentPresetsService implements OnModuleInit {
  private readonly logger = new Logger(AgentPresetsService.name);
  private presets = new Map<string, AgentPreset>();

  async onModuleInit(): Promise<void> {
    const loaded = await loadAgentPresets(this.logger);
    this.presets = new Map(loaded.map((p) => [p.id, p]));
    this.logger.log(`Loaded ${this.presets.size} agent preset(s)`);
  }

  list(): AgentPreset[] {
    return [...this.presets.values()];
  }

  get(id: string): AgentPreset {
    return orNotFound(this.presets.get(id), 'Agent preset', id);
  }

  resolve(id: string): AgentPreset | undefined {
    return this.presets.get(id);
  }
}
