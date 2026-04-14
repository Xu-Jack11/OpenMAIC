/**
 * SSE stream of generation-agent events for a classroom job.
 *
 * Replay-on-subscribe: the hub keeps a ring buffer of recent events, so a
 * reconnecting client sees the full history before new events arrive.
 *
 * Complements (does not replace) the polling endpoint at
 * `/api/generate-classroom/[jobId]`. Opt-in per client; existing polling
 * clients keep working unchanged.
 */

import { type NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  isValidClassroomJobId,
  readClassroomGenerationJob,
} from '@/lib/server/classroom-job-store';
import { generationAgentEventHub } from '@/lib/generation/agent/event-hub';
import type { GenerationAgentEvent } from '@/lib/generation/agent/events';

const log = createLogger('ClassroomJobStream');

export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 15000;

export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  if (!isValidClassroomJobId(jobId)) {
    return new Response('Invalid classroom generation job id', { status: 400 });
  }

  const job = await readClassroomGenerationJob(jobId);
  if (!job) {
    return new Response('Classroom generation job not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const abort = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const write = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch (err) {
          log.warn(`SSE enqueue failed [jobId=${jobId}]`, err);
          closeOnce();
        }
      };

      const sendEvent = (event: GenerationAgentEvent) => {
        write(`event: ${event.type}\n`);
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Initial heartbeat — lets the client know the connection is open.
      write(`: connected jobId=${jobId}\n\n`);

      const unsubscribe = generationAgentEventHub.subscribe(jobId, sendEvent);

      const heartbeat = setInterval(() => {
        write(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        closeOnce();
      };

      abort.addEventListener('abort', cleanup);

      // If the job is already terminal at subscribe time, close after replay.
      if (job.status === 'succeeded' || job.status === 'failed') {
        // Give the buffered events a tick to flush to the client.
        setTimeout(cleanup, 50);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
