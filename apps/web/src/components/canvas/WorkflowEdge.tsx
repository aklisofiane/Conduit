import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { tokens } from '../../styles/theme.js';

/**
 * Edge data carries `onDelete` so the × button on a selected edge can
 * delegate to the same removal path as Backspace (`onEdgesChange` with a
 * `remove` change). Keeping a single source of truth means the canvas
 * draft stays in sync regardless of which delete affordance was used.
 */
export interface WorkflowEdgeData extends Record<string, unknown> {
  onDelete?: (edgeId: string) => void;
}

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  markerEnd,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const stroke = selected ? tokens.color.accent : tokens.color.edge;
  const onDelete = (data as WorkflowEdgeData | undefined)?.onDelete;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth: selected ? 2 : 1.5 }}
      />
      {selected && onDelete && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(id);
            }}
            aria-label="Delete edge"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              width: 18,
              height: 18,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 9,
              border: `1px solid ${tokens.color.accent}`,
              background: tokens.color.bgPanel,
              color: tokens.color.accent,
              fontSize: 11,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
