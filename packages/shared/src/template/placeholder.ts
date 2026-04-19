/**
 * Template placeholder convention: `<alias>` strings appear where a
 * `WorkflowConnection.id` would in a real `WorkflowDefinition`. They stand in
 * for connections the user hasn't bound yet. Placeholders are bundle-scoped —
 * the same `<github>` placeholder across every workflow in a multi-workflow
 * bundle binds to a single real `WorkflowConnection` per workflow (the
 * connection is recreated per workflow, but the alias + credential binding
 * chosen by the user is shared).
 *
 * Resolution happens exactly once, at `POST /workflows/from-template/:id`.
 * After resolution, definitions carry real cuids and no longer reference
 * `<...>` strings.
 */
const PLACEHOLDER_PATTERN = /^<([a-z][a-z0-9-]*)>$/i;

export function isPlaceholder(value: unknown): value is string {
  return typeof value === 'string' && PLACEHOLDER_PATTERN.test(value);
}

export function placeholderAlias(value: string): string | undefined {
  const match = PLACEHOLDER_PATTERN.exec(value);
  return match?.[1];
}

export function formatPlaceholder(alias: string): string {
  return `<${alias}>`;
}
