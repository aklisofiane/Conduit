import { z } from 'zod';

/**
 * Persistent canvas state (node positions, viewport) stored on
 * `WorkflowDefinition.ui`. Keyed by node name so renames stay coherent.
 */
export const canvasUiSchema = z.object({
  nodePositions: z.record(
    z.object({
      x: z.number(),
      y: z.number(),
    }),
  ),
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    zoom: z.number(),
  }),
});
export type CanvasUI = z.infer<typeof canvasUiSchema>;
