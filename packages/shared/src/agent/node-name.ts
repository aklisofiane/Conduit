import { z } from 'zod';

/**
 * Valid node identifier pattern. Used for `AgentConfig.name` and the
 * `Edge.from` / `Edge.to` references — node names are the stable, user-
 * editable identifier that downstream lookups converge on
 * (`.conduit/<name>.md`, `NodeRun.nodeName`, `workspace.inherit.fromNode`).
 */
export const NODE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const nodeNameSchema = z
  .string()
  .min(1)
  .regex(NODE_NAME_PATTERN, 'Node name must match /^[A-Za-z_][A-Za-z0-9_]*$/');
