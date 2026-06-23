import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  collectTemplatePlaceholderDetails,
  connectionScopeSchema,
  findMcpPresetByPlatform,
  isScheduledTrigger,
  platformForScopeKind,
  resolveTemplate,
  summarizeTemplate,
  type ConnectionScopeKind,
  type Platform,
  type TemplatePlaceholder,
  type TemplateSummary,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { assertDefinitionValid } from '../../common/assert-definition-valid';
import { errMessage } from '../../common/err-message';
import { TemporalService } from '../../temporal/temporal.service';
import { resolveTemporalSlug } from '../../temporal/temporal-slug';
import { AgentPresetsService } from '../agent-presets/agent-presets.service';
import { loadTemplates, type LoadedTemplate } from './template-loader';
import type {
  CreateFromTemplateDto,
  ImportTemplateDto,
  TemplateBinding,
} from './dto';

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
    private readonly presets: AgentPresetsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const loaded = await loadTemplates(this.logger, (id) => this.presets.resolve(id));
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

  /** Catalog path: instantiate a Conduit-shipped template by id. */
  async createFromTemplate(
    orgId: string,
    templateId: string,
    dto: CreateFromTemplateDto,
  ): Promise<CreatedFromTemplate> {
    const loaded = this.templates.get(templateId);
    if (!loaded) throw new NotFoundException(`Template ${templateId} not found`);
    return this.instantiate(orgId, loaded, dto.bindings);
  }

  /**
   * Import path: instantiate a user-uploaded bundle. `dto.template` has already
   * passed `templateFileSchema` at the controller; we derive placeholder
   * details here (authoritatively, ignoring any client-side summary) and run
   * the identical instantiation core — including the per-workflow
   * `assertDefinitionValid` guard inside the transaction.
   */
  async importTemplate(
    orgId: string,
    dto: ImportTemplateDto,
  ): Promise<CreatedFromTemplate> {
    const placeholderDetails = collectTemplatePlaceholderDetails(dto.template);
    const loaded: LoadedTemplate = {
      file: dto.template,
      placeholders: placeholderDetails.map((p) => p.alias),
      placeholderDetails,
    };
    return this.instantiate(orgId, loaded, dto.bindings);
  }

  /**
   * Shared instantiation core for both the catalog and import paths. Takes an
   * in-memory `LoadedTemplate` (whether looked up by id or built from an upload)
   * plus the org and the binding choices, materializes connections, resolves +
   * validates every workflow, persists them paused, and upserts schedules.
   */
  private async instantiate(
    orgId: string,
    loaded: LoadedTemplate,
    bindings: Record<string, TemplateBinding>,
  ): Promise<CreatedFromTemplate> {
    this.assertBindingsCoverPlaceholders(loaded, bindings);
    await this.assertExistingBindingsValid(orgId, loaded, bindings);

    const created = await this.prisma.$transaction(async (tx) => {
      // Materialize "new" bindings into real Connection rows once per
      // template-apply (shared across all workflows in the bundle).
      const aliasToConnId: Record<string, string> = {};
      for (const placeholder of loaded.placeholderDetails) {
        const binding = bindings[placeholder.alias];
        if (!binding) continue;
        if (binding.mode === 'existing') {
          aliasToConnId[placeholder.alias] = binding.connectionId;
        } else {
          this.assertScopeCompatible(placeholder, binding.scope.kind);
          const conn = await tx.connection.create({
            data: {
              orgId,
              credentialId: binding.credentialId,
              name: binding.name,
              scope: binding.scope as unknown as object,
            },
          });
          aliasToConnId[placeholder.alias] = conn.id;
        }
      }

      const results: {
        id: string;
        name: string;
        definition: WorkflowDefinition;
        isActive: boolean;
      }[] = [];

      for (const wf of loaded.file.workflows) {
        const resolved = resolveTemplate(
          { ...loaded.file, workflows: [wf] },
          aliasToConnId,
        );
        const resolvedDefinition = resolved[0]!.definition;
        for (const trigger of resolvedDefinition.triggers) {
          if (!trigger.connectionId) continue;
          const conn = await tx.connection.findUnique({
            where: { id: trigger.connectionId },
            select: { scope: true },
          });
          if (conn) {
            const parsed = connectionScopeSchema.parse(conn.scope);
            const derived = platformForScopeKind(parsed.kind);
            if (derived) trigger.platform = derived;
          }
        }
        // Preset-backed MCP servers follow the bound connection's platform,
        // same idea as the trigger.platform rewrite above: the template JSON
        // ships a GitHub default, but a GitLab binding gets the GitLab preset.
        for (const server of resolvedDefinition.mcpServers) {
          if (!server.presetId || !server.connectionId) continue;
          const conn = await tx.connection.findUnique({
            where: { id: server.connectionId },
            select: { scope: true },
          });
          if (!conn) continue;
          const parsed = connectionScopeSchema.parse(conn.scope);
          const source = platformForScopeKind(parsed.kind);
          const platform = source
            ? (source.toUpperCase() as Platform)
            : undefined;
          const preset = platform
            ? findMcpPresetByPlatform(platform)
            : undefined;
          if (!preset) {
            throw new BadRequestException(
              `MCP server "${server.name}" is preset-backed, but the bound connection's scope kind "${parsed.kind}" has no matching MCP preset.`,
            );
          }
          if (preset.id !== server.presetId) {
            server.presetId = preset.id;
            server.name = preset.name;
            server.transport = structuredClone(preset.transport);
          }
        }
        assertDefinitionValid(resolvedDefinition);

        const finalWf = await tx.workflow.create({
          data: {
            orgId,
            name: wf.name,
            description: wf.description,
            definition: resolvedDefinition as unknown as object,
            isActive: false,
          },
          select: { id: true, name: true, isActive: true },
        });
        results.push({ ...finalWf, definition: resolvedDefinition });
      }

      return results;
    });

    // Schedules live outside the DB — upsert after commit so a Temporal hiccup
    // doesn't roll back the workflow rows.
    await Promise.allSettled(
      created.map(async ({ id, name, definition, isActive }) => {
        const trigger = definition.triggers[0];
        if (!isScheduledTrigger(trigger)) return;
        try {
          // Freeze the slug for this freshly created workflow so its schedule
          // (and the poll/cron runs it spawns) carry the human-readable prefix.
          const slug = await resolveTemporalSlug(this.prisma, {
            id,
            name,
            definition,
            temporalSlug: null,
          });
          if (trigger.type === 'cron') {
            await this.temporal.upsertWorkflowSchedule({
              kind: 'cron',
              workflowId: id,
              cron: trigger.cron,
              timezone: trigger.timezone,
              active: isActive,
              slug,
            });
          } else {
            await this.temporal.upsertWorkflowSchedule({
              kind: 'polling',
              workflowId: id,
              intervalSec: trigger.intervalSec,
              active: isActive,
              slug,
            });
          }
        } catch (err) {
          this.logger.warn(
            `Upserting schedule for ${id} failed: ${errMessage(err)}`,
          );
        }
      }),
    );

    return {
      templateId: loaded.file.id,
      workflows: created.map(({ id, name }) => ({ id, name })),
    };
  }

  private assertBindingsCoverPlaceholders(
    loaded: LoadedTemplate,
    bindings: Record<string, TemplateBinding>,
  ): void {
    const boardAliases = new Set(
      loaded.placeholderDetails
        .filter((p) => p.expectedScopeKinds.includes('github_projects_v2'))
        .map((p) => p.alias),
    );
    const missing = loaded.placeholders.filter(
      (p) => !bindings[p] && !boardAliases.has(p),
    );
    if (missing.length > 0) {
      throw new BadRequestException({
        message: `Missing connection bindings for placeholders: ${missing.map((m) => `<${m}>`).join(', ')}`,
        missing,
      });
    }
  }

  /**
   * Validate that `existing`-mode bindings point at real Connection rows
   * whose scope kind is compatible with every slot the alias resolves into.
   * `new`-mode bindings are validated against the same rule, but we don't
   * need a DB read for those — `binding.scope` is already typed.
   * `credentialId` references are checked in one round-trip. Cross-org id
   * references are reported as "unknown" (404-shaped here, BadRequest on the
   * existing surface) — we never confirm that a different org's row exists.
   */
  private async assertExistingBindingsValid(
    orgId: string,
    loaded: LoadedTemplate,
    bindings: Record<string, TemplateBinding>,
  ): Promise<void> {
    const credentialIds = new Set<string>();
    const existingConnIds = new Set<string>();
    for (const binding of Object.values(bindings)) {
      if (binding.mode === 'existing') existingConnIds.add(binding.connectionId);
      else credentialIds.add(binding.credentialId);
    }

    const [credRows, connRows] = await Promise.all([
      credentialIds.size > 0
        ? this.prisma.credential.findMany({
            where: { id: { in: [...credentialIds] }, orgId },
            select: { id: true },
          })
        : Promise.resolve([]),
      existingConnIds.size > 0
        ? this.prisma.connection.findMany({
            where: { id: { in: [...existingConnIds] }, orgId },
            select: { id: true, scope: true },
          })
        : Promise.resolve([]),
    ]);

    const missingCreds = diff(credentialIds, credRows);
    if (missingCreds.length > 0) {
      throw new BadRequestException(
        `Unknown credentialId(s): ${missingCreds.join(', ')}`,
      );
    }
    const missingConns = diff(existingConnIds, connRows);
    if (missingConns.length > 0) {
      throw new BadRequestException(
        `Unknown connectionId(s): ${missingConns.join(', ')}`,
      );
    }

    const placeholderByAlias = new Map(
      loaded.placeholderDetails.map((p) => [p.alias, p]),
    );
    const connKindById = new Map<string, ConnectionScopeKind>();
    for (const row of connRows) {
      const parsed = connectionScopeSchema.parse(row.scope);
      connKindById.set(row.id, parsed.kind);
    }
    for (const [alias, binding] of Object.entries(bindings)) {
      const placeholder = placeholderByAlias.get(alias);
      if (!placeholder) continue;
      if (binding.mode === 'existing') {
        const kind = connKindById.get(binding.connectionId);
        if (kind) this.assertScopeCompatible(placeholder, kind);
      }
    }
  }

  private assertScopeCompatible(
    placeholder: TemplatePlaceholder,
    actualKind: ConnectionScopeKind,
  ): void {
    for (const expected of placeholder.expectedScopeKinds) {
      if (expected === 'any') continue;
      if (expected === 'repo') {
        if (actualKind !== 'github_repo' && actualKind !== 'gitlab_project') {
          throw new BadRequestException(
            `Binding for <${placeholder.alias}> has scope kind "${actualKind}", but the template requires a repo-type scope (github_repo or gitlab_project).`,
          );
        }
        continue;
      }
      if (expected !== actualKind) {
        throw new BadRequestException(
          `Binding for <${placeholder.alias}> has scope kind "${actualKind}", but the template requires "${expected}" for at least one slot.`,
        );
      }
    }
  }
}

function toSummary(t: LoadedTemplate): TemplateSummary {
  return summarizeTemplate(t.file);
}

function diff(want: Set<string>, found: { id: string }[]): string[] {
  const foundIds = new Set(found.map((c) => c.id));
  return [...want].filter((id) => !foundIds.has(id));
}
