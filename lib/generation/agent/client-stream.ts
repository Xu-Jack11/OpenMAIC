/**
 * Client-side SSE subscriber for the generation agent event stream.
 *
 * Opens an `EventSource` to `/api/generate-classroom/{jobId}/stream`,
 * dispatches every event into the `useAgentActivityStore` Zustand store, and
 * exposes a minimal React hook `useAgentActivityStream(jobId)`.
 *
 * The hook is idempotent: calling it with the same `jobId` reuses the
 * existing connection. Calling it with `null` is a no-op (useful before a
 * jobId is known). The EventSource is cleaned up on unmount or when `jobId`
 * changes.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { generationAgentEventSchema } from '@/lib/generation/agent/events';
import { useAgentActivityStore } from '@/lib/store/agent-activity';
import { useAgentArtifactStore } from '@/lib/store/agent-artifacts';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/** SSE event types the subscriber registers handlers for. */
const EVENT_TYPES = [
  'agent.started',
  'agent.thinking',
  'agent.tool_call',
  'agent.tool_result',
  'agent.text_delta',
  'agent.progress',
  'agent.completed',
  'agent.failed',
  'agent.checkpoint',
  'classroom.done',
  'agent.artifact_created',
];

export function useAgentActivityStream(jobId: string | null) {
  const [status, setStatus] = useState<StreamStatus>(jobId ? 'connecting' : 'idle');
  const esRef = useRef<EventSource | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const applyEvent = useAgentActivityStore((s) => s.applyEvent);
  const reset = useAgentActivityStore((s) => s.reset);

  useEffect(() => {
    if (!jobId) return;

    // Already connected to this jobId — nothing to do.
    if (currentJobIdRef.current === jobId && esRef.current) return;

    // Tear down any previous connection.
    esRef.current?.close();
    reset();
    currentJobIdRef.current = jobId;
    // Status must be synchronously set before the EventSource is opened so
    // the UI shows "connecting" immediately. This is a legitimate effect
    // synchronizing with an external subscription (EventSource).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('connecting');

    const url = `/api/generate-classroom/${encodeURIComponent(jobId)}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setStatus('open');

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus('error');
      }
    };

    const handler = (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data as string) as unknown;
        const parsed = generationAgentEventSchema.safeParse(raw);
        if (parsed.success) {
          applyEvent(parsed.data);
          if (parsed.data.type === 'agent.artifact_created') {
            useAgentArtifactStore.getState().ingestEvent(parsed.data);
          }
          if (parsed.data.type === 'classroom.done') {
            es.close();
            setStatus('closed');
          }
        }
      } catch {
        // Ignore malformed events (e.g. heartbeat comments).
      }
    };

    for (const t of EVENT_TYPES) es.addEventListener(t, handler);

    return () => {
      for (const t of EVENT_TYPES) es.removeEventListener(t, handler);
      es.close();
      esRef.current = null;
      currentJobIdRef.current = null;
    };
  }, [jobId, applyEvent, reset]);

  return { status };
}

/**
 * Convenience selector: subscribes to the tree state for rendering via a
 * single shallow comparison so one store mutation triggers at most one
 * re-render in the consuming component.
 */
export function useAgentActivity() {
  return useAgentActivityStore((s) => ({
    nodes: s.nodes,
    rootIds: s.rootIds,
    classroomResult: s.classroomResult,
  }));
}
