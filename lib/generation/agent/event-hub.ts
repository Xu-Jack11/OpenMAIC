/**
 * In-memory pub/sub hub for per-job generation agent events.
 *
 * Used by the orchestrator (producer) and the SSE route (consumer). Also
 * keeps a ring buffer per job so late subscribers can replay recent history.
 *
 * Single-process assumption — matches the filesystem-backed job store. For
 * multi-instance deployment, fall back to the existing polling endpoint.
 */

import { EventEmitter } from 'events';
import type { GenerationAgentEvent } from './events';

const REPLAY_BUFFER_SIZE = 500;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour; cleaned lazily on publish

interface JobChannel {
  emitter: EventEmitter;
  buffer: GenerationAgentEvent[];
  lastActivity: number;
  closed: boolean;
}

class EventHub {
  private readonly channels = new Map<string, JobChannel>();

  private getOrCreate(jobId: string): JobChannel {
    let ch = this.channels.get(jobId);
    if (!ch) {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(100); // SSE clients may fan out
      ch = { emitter, buffer: [], lastActivity: Date.now(), closed: false };
      this.channels.set(jobId, ch);
    }
    return ch;
  }

  publish(jobId: string, event: GenerationAgentEvent): void {
    this.cleanupStale();
    const ch = this.getOrCreate(jobId);
    ch.lastActivity = Date.now();
    ch.buffer.push(event);
    if (ch.buffer.length > REPLAY_BUFFER_SIZE) ch.buffer.shift();
    ch.emitter.emit('event', event);
  }

  /**
   * Subscribe to a job's event stream. Returns an unsubscribe function. The
   * listener is called with every buffered event (replay) synchronously, then
   * with every future event.
   */
  subscribe(jobId: string, listener: (event: GenerationAgentEvent) => void): () => void {
    const ch = this.getOrCreate(jobId);
    // Replay buffered events synchronously so the subscriber has the full
    // history before the next publish arrives.
    for (const buffered of ch.buffer) listener(buffered);
    ch.emitter.on('event', listener);
    return () => {
      ch.emitter.off('event', listener);
    };
  }

  close(jobId: string): void {
    const ch = this.channels.get(jobId);
    if (!ch) return;
    ch.closed = true;
    ch.emitter.emit('close');
    ch.emitter.removeAllListeners();
    this.channels.delete(jobId);
  }

  /** Returns true if the job has been closed (terminal). */
  isClosed(jobId: string): boolean {
    const ch = this.channels.get(jobId);
    return !ch || ch.closed;
  }

  private cleanupStale(): void {
    const now = Date.now();
    for (const [id, ch] of this.channels.entries()) {
      if (now - ch.lastActivity > JOB_TTL_MS) {
        ch.emitter.removeAllListeners();
        this.channels.delete(id);
      }
    }
  }
}

// Module-level singleton: survives across requests within the same Node
// process. Use globalThis to survive Next.js dev-mode HMR module reloads.
const GLOBAL_KEY = '__openmaic_generation_agent_event_hub__';
type GlobalWithHub = typeof globalThis & { [GLOBAL_KEY]?: EventHub };
const g = globalThis as GlobalWithHub;

export const generationAgentEventHub: EventHub = g[GLOBAL_KEY] ?? new EventHub();
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = generationAgentEventHub;
