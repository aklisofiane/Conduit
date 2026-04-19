// `<alias>` strings stand in for WorkflowConnection ids in template JSON;
// resolved once at POST /workflows/from-template/:id.
const PLACEHOLDER_PATTERN = /^<([a-z][a-z0-9-]*)>$/i;

export function placeholderAlias(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return PLACEHOLDER_PATTERN.exec(value)?.[1];
}

export function isPlaceholder(value: unknown): value is string {
  return placeholderAlias(value) !== undefined;
}

export function formatPlaceholder(alias: string): string {
  return `<${alias}>`;
}
