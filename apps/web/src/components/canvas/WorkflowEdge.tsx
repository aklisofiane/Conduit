import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { tokens } from '../../styles/theme.js';

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const stroke = selected ? tokens.color.accent : tokens.color.edge;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth: selected ? 2 : 1.5 }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              deleteElements({ edges: [{ id }] });
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
