import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { AgentPreset } from '@conduit/shared';
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
    const p = this.presets.get(id);
    if (!p) throw new NotFoundException(`Agent preset ${id} not found`);
    return p;
  }

  resolve(id: string): AgentPreset | undefined {
    return this.presets.get(id);
  }
}
