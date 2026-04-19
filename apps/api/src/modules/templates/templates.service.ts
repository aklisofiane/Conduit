import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  resolveTemplate,
  type TemplateSummary,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { assertDefinitionValid } from '../../common/assert-definition-valid';
import { TemporalService } from '../../temporal/temporal.service';
import { encrypt } from '../credentials/crypto';
import { loadTemplates, type LoadedTemplate } from './template-loader';
import type { CreateFromTemplateDto, TemplateBinding } from './dto';

export interface CreatedFromTemplate {
  templateId: string;
  workflows: { id: string; name: string }[];
}

@Injectable()
export class TemplatesService implements OnModuleInit {
  private readonly logger = new Logger(TemplatesService.name);
  private templates = new Map<string, LoadedTemplate>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
  ) {}

  async onModuleInit(): Promise<void> {
    const loaded = await loadTemplates(this.logger);
    this.templates = new Map(loaded.map((t) => [t.file.id, t]));
    this.logger.log(`Loaded ${this.templates.size} workflow template(s)`);
  }

  list(): TemplateSummary[] {
    return [...this.templates.values()].map(toSummary);
  }

  get(templateId: string): TemplateSummary {
    const t = this.templates.get(templateId);
    if (!t) throw new NotFoundException(`Template ${templateId} not found`);
    return toSummary(t);
  }

  async createFromTemplate(
    templateId: string,
    dto: CreateFromTemplateDto,
  ): Promise<CreatedFromTemplate> {
    const loaded = this.templates.get(templateId);
    if (!loaded) throw new NotFoundException(`Template ${templateId} not found`);

    this.assertBindingsCoverPlaceholders(loaded, dto.bindings);
    await this.assertCredentialsExist(dto.bindings);

    const placeholderAliases = loaded.placeholders;

    const created = await this.prisma.$transaction(async (tx) => {
      const results: {
        id: string;
        name: string;
        definition: WorkflowDefinition;
        isActive: boolean;
      }[] = [];

      for (const wf of loaded.file.workflows) {
        const stub = await tx.workflow.create({
          data: {
            name: wf.name,
            description: wf.description,
            definition: {} as unknown as object,
            isActive: false,
          },
        });

        const aliasToConn: Record<string, string> = {};
        for (const alias of placeholderAliases) {
          const binding = dto.bindings[alias];
          if (!binding) {
            throw new BadRequestException(`Missing binding for <${alias}>`);
          }
          if (binding.mode === 'existing') {
            aliasToConn[alias] = binding.connectionId;
          } else {
            const conn = await tx.workflowConnection.create({
              data: {
                workflowId: stub.id,
                alias: binding.alias,
                credentialId: binding.credentialId,
                owner: binding.owner,
                repo: binding.repo,
                webhookSecret: binding.webhookSecret
                  ? encrypt(binding.webhookSecret)
                  : null,
              },
            });
            aliasToConn[alias] = conn.id;
          }
        }

        const resolved = resolveTemplate(
          { ...loaded.file, workflows: [wf] },
          aliasToConn,
        );
        const resolvedDefinition = resolved[0]!.definition;
        assertDefinitionValid(resolvedDefinition);

        const finalWf = await tx.workflow.update({
          where: { id: stub.id },
          data: { definition: resolvedDefinition as unknown as object },
          select: { id: true, name: true, isActive: true },
        });
        results.push({ ...finalWf, definition: resolvedDefinition });
      }

      return results;
    });

    // Schedules live outside the DB — upsert after commit so a Temporal hiccup
    // doesn't roll back the workflow rows.
    await Promise.allSettled(
      created.map(async ({ id, definition, isActive }) => {
        if (definition.trigger.mode.kind !== 'polling') return;
        try {
          await this.temporal.upsertPollSchedule({
            workflowId: id,
            intervalSec: definition.trigger.mode.intervalSec,
            active: isActive && definition.trigger.mode.active,
          });
        } catch (err) {
          this.logger.warn(
            `Upserting poll schedule for ${id} failed: ${String(err)}`,
          );
        }
      }),
    );

    return {
      templateId,
      workflows: created.map(({ id, name }) => ({ id, name })),
    };
  }

  private assertBindingsCoverPlaceholders(
    loaded: LoadedTemplate,
    bindings: Record<string, TemplateBinding>,
  ): void {
    const missing = loaded.placeholders.filter((p) => !bindings[p]);
    if (missing.length > 0) {
      throw new BadRequestException({
        message: `Missing connection bindings for placeholders: ${missing.map((m) => `<${m}>`).join(', ')}`,
        missing,
      });
    }
  }

  private async assertCredentialsExist(
    bindings: Record<string, TemplateBinding>,
  ): Promise<void> {
    const credentialIds = new Set<string>();
    const existingConnectionIds = new Set<string>();
    for (const binding of Object.values(bindings)) {
      if (binding.mode === 'new') credentialIds.add(binding.credentialId);
      else existingConnectionIds.add(binding.connectionId);
    }

    const [credRows, connRows] = await Promise.all([
      credentialIds.size > 0
        ? this.prisma.platformCredential.findMany({
            where: { id: { in: [...credentialIds] } },
            select: { id: true },
          })
        : Promise.resolve([]),
      existingConnectionIds.size > 0
        ? this.prisma.workflowConnection.findMany({
            where: { id: { in: [...existingConnectionIds] } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const missingCreds = diff(credentialIds, credRows);
    if (missingCreds.length > 0) {
      throw new BadRequestException(
        `Unknown credentialId(s): ${missingCreds.join(', ')}`,
      );
    }
    const missingConns = diff(existingConnectionIds, connRows);
    if (missingConns.length > 0) {
      throw new BadRequestException(
        `Unknown connectionId(s): ${missingConns.join(', ')}`,
      );
    }
  }
}

function toSummary(t: LoadedTemplate): TemplateSummary {
  return {
    id: t.file.id,
    name: t.file.name,
    description: t.file.description,
    category: t.file.category,
    workflowCount: t.file.workflows.length,
    placeholders: t.placeholders,
  };
}

function diff(want: Set<string>, found: { id: string }[]): string[] {
  const foundIds = new Set(found.map((c) => c.id));
  return [...want].filter((id) => !foundIds.has(id));
}
