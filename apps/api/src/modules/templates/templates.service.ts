import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  WorkflowValidationError,
  assertValidWorkflowDefinition,
  resolveTemplate,
  type TemplateSummary,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { TemporalService } from '../../temporal/temporal.service';
import { encrypt } from '../credentials/crypto';
import { loadTemplates, type LoadedTemplate } from './template-loader';
import type { CreateFromTemplateDto, TemplateBinding } from './dto';

export interface CreatedFromTemplate {
  templateId: string;
  workflows: { id: string; name: string }[];
}

/**
 * Owns the on-disk template catalog and the "create workflows from
 * template" flow. Templates are loaded once at boot into an in-memory map;
 * editing a JSON file requires an API restart.
 *
 * Creation is a single Prisma `$transaction`: N workflow rows + one
 * `WorkflowConnection` per (workflow, unique placeholder) binding. If any
 * workflow fails `validateWorkflowDefinition` (e.g. a ticket-branch on a
 * webhook that can't carry an issue), the whole bundle rolls back.
 * Temporal Schedule upserts happen after the transaction commits — a
 * schedule failure doesn't undo the workflow rows (an inconsistent
 * schedule recovers on next save or API boot).
 */
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
    return [...this.templates.values()].map((t) => ({
      id: t.file.id,
      name: t.file.name,
      description: t.file.description,
      category: t.file.category,
      workflowCount: t.file.workflows.length,
      placeholders: t.placeholders,
    }));
  }

  get(templateId: string): TemplateSummary {
    const t = this.templates.get(templateId);
    if (!t) throw new NotFoundException(`Template ${templateId} not found`);
    return {
      id: t.file.id,
      name: t.file.name,
      description: t.file.description,
      category: t.file.category,
      workflowCount: t.file.workflows.length,
      placeholders: t.placeholders,
    };
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

    const createdIds = await this.prisma.$transaction(async (tx) => {
      const results: { id: string; name: string }[] = [];

      for (const wf of loaded.file.workflows) {
        // Per-workflow binding map from alias → real WorkflowConnection id.
        // "existing" bindings reuse the given connectionId directly; "new"
        // bindings create one connection row per workflow (connections are
        // per-workflow in the schema).
        const created = await tx.workflow.create({
          data: {
            name: wf.name,
            description: wf.description,
            definition: {} as unknown as object, // filled in after connections are created
            isActive: false,
          },
        });

        const aliasToConn: Record<string, string> = {};
        for (const alias of placeholderAliases) {
          const binding = dto.bindings[alias];
          if (!binding) {
            // Defensive — assertBindingsCoverPlaceholders already rejected this.
            throw new BadRequestException(`Missing binding for <${alias}>`);
          }
          if (binding.mode === 'existing') {
            aliasToConn[alias] = binding.connectionId;
          } else {
            const conn = await tx.workflowConnection.create({
              data: {
                workflowId: created.id,
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
        assertSemanticValid(resolvedDefinition);

        const finalWf = await tx.workflow.update({
          where: { id: created.id },
          data: { definition: resolvedDefinition as unknown as object },
          select: { id: true, name: true },
        });
        results.push(finalWf);
      }

      return results;
    });

    // Schedules live outside the DB — do the upsert per workflow after the
    // transaction so a Temporal hiccup doesn't roll back the workflow rows.
    await Promise.allSettled(
      createdIds.map(async ({ id }) => {
        const wf = await this.prisma.workflow.findUnique({ where: { id } });
        if (!wf) return;
        const def = wf.definition as Partial<WorkflowDefinition> | null;
        if (def?.trigger?.mode.kind !== 'polling') return;
        try {
          await this.temporal.upsertPollSchedule({
            workflowId: id,
            intervalSec: def.trigger.mode.intervalSec,
            active: wf.isActive && def.trigger.mode.active,
          });
        } catch (err) {
          this.logger.warn(
            `Upserting poll schedule for ${id} failed: ${String(err)}`,
          );
        }
      }),
    );

    return { templateId, workflows: createdIds };
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
    if (credentialIds.size > 0) {
      const found = await this.prisma.platformCredential.findMany({
        where: { id: { in: [...credentialIds] } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const missing = [...credentialIds].filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown credentialId(s): ${missing.join(', ')}`,
        );
      }
    }
    if (existingConnectionIds.size > 0) {
      const found = await this.prisma.workflowConnection.findMany({
        where: { id: { in: [...existingConnectionIds] } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const missing = [...existingConnectionIds].filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown connectionId(s): ${missing.join(', ')}`,
        );
      }
    }
  }
}

function assertSemanticValid(definition: WorkflowDefinition): void {
  try {
    assertValidWorkflowDefinition(definition);
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      throw new BadRequestException({
        message: err.message,
        issues: err.issues,
      });
    }
    throw err;
  }
}
