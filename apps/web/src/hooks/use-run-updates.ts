import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { agentEventToLogKind } from '@conduit/shared';
import { apiBaseUrl } from '../api/client.js';
import { runKey, runLogsKey } from '../api/hooks.js';
import type { ExecutionLogRow, RunUpdateFrame } from '../api/types.js';

/**
 * Subscribes to the `/runs` Socket.IO namespace for the given runId.
 * Incoming `node-update` frames are pushed into the TanStack Query cache
 * for both the run detail query and the per-node log query, so anything
 * that re-reads those caches sees the live data without extra HTTP calls.
 *
 * Returns the most recent frame for UIs that want instant indicators
 * (e.g. the streaming-cursor dot on the run detail page).
 */
export function useRunUpdates(runId: string | undefined): RunUpdateFrame | undefined {
  const qc = useQueryClient();
  const socketRef = useRef<Socket | undefined>(undefined);
  const [latest, setLatest] = useState<RunUpdateFrame | undefined>();

  useEffect(() => {
    if (!runId) return;
    const socket = io(`${apiBaseUrl}/runs`, {
      query: { runId },
      transports: ['websocket'],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('node-update', (frame: RunUpdateFrame) => {
      setLatest(frame);
      appendFrameToCache(qc, frame);
    });

    return () => {
      socket.disconnect();
      socketRef.current = undefined;
    };
  }, [runId, qc]);

  return latest;
}

function frameKind(frame: RunUpdateFrame): ExecutionLogRow['kind'] {
  return frame.event.type === 'system'
    ? 'SYSTEM'
    : agentEventToLogKind(frame.event.type);
}

function appendFrameToCache(
  qc: ReturnType<typeof useQueryClient>,
  frame: RunUpdateFrame,
): void {
  const row: ExecutionLogRow = {
    id: `live-${frame.ts}-${Math.random().toString(36).slice(2, 8)}`,
    runId: frame.runId,
    nodeName: frame.nodeName,
    ts: frame.ts,
    level: 'INFO',
    kind: frameKind(frame),
    payload: frame.event,
  };

  qc.setQueryData<ExecutionLogRow[]>(runLogsKey(frame.runId, frame.nodeName), (old) =>
    old ? [...old, row] : [row],
  );
  qc.setQueryData<ExecutionLogRow[]>(runLogsKey(frame.runId), (old) =>
    old ? [...old, row] : [row],
  );

  if (frame.event.type === 'done') {
    void qc.invalidateQueries({ queryKey: runKey(frame.runId) });
  }
}
