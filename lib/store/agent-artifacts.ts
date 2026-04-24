/**
 * Zustand store for agent-generated artifact metadata.
 *
 * Populated from live SSE `agent.artifact_created` events and, on stage mount,
 * from IndexedDB via the metadata-only summary query. Full markdown is fetched
 * lazily by {@link AgentArtifactState.getOne} so large documents do not
 * inflate the in-memory snapshot.
 *
 * The sorted-per-stage view is memoized inside the store so the sidebar
 * selector returns the same array reference when nothing has changed, avoiding
 * needless re-renders of the artifacts list.
 */

'use client';

import { create } from 'zustand';
import {
  getAgentArtifact,
  getAgentArtifactSummaries,
  type AgentArtifactKind,
  type AgentArtifactRecord,
  type AgentArtifactSummary,
} from '@/lib/utils/database';

export interface AgentArtifactEntry {
  stageId: string;
  artifactId: string;
  kind: AgentArtifactKind;
  title: string;
  /** Full markdown, hydrated lazily. `null` until fetched from IndexedDB. */
  markdown: string | null;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentArtifactCreatedEvent {
  stageId: string;
  artifactId: string;
  kind: AgentArtifactKind;
  title: string;
  byteSize: number;
  timestamp?: number;
}

interface AgentArtifactState {
  /** artifactId -> entry, scoped by stageId in an outer map. */
  byStage: Record<string, Record<string, AgentArtifactEntry>>;

  ingestEvent(event: AgentArtifactCreatedEvent): void;
  hydrateFromDb(stageId: string): Promise<void>;
  getOne(stageId: string, artifactId: string): Promise<AgentArtifactEntry | null>;
  clearStage(stageId: string): void;
}

function summaryToEntry(s: AgentArtifactSummary): AgentArtifactEntry {
  return {
    stageId: s.stageId,
    artifactId: s.artifactId,
    kind: s.kind,
    title: s.title,
    markdown: null,
    byteSize: s.byteSize,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function recordToEntry(r: AgentArtifactRecord): AgentArtifactEntry {
  return {
    stageId: r.stageId,
    artifactId: r.artifactId,
    kind: r.kind,
    title: r.title,
    markdown: r.markdown,
    byteSize: r.markdown.length,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const useAgentArtifactStore = create<AgentArtifactState>((set, get) => ({
  byStage: {},

  ingestEvent(event) {
    const now = event.timestamp ?? Date.now();
    set((state) => {
      const forStage = state.byStage[event.stageId] ?? {};
      const existing = forStage[event.artifactId];
      // Preserve already-hydrated markdown so a live event for an artifact the
      // user just opened doesn't drop its body back to null.
      const entry: AgentArtifactEntry = {
        stageId: event.stageId,
        artifactId: event.artifactId,
        kind: event.kind,
        title: event.title,
        markdown: existing?.markdown ?? null,
        byteSize: event.byteSize,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      return {
        byStage: {
          ...state.byStage,
          [event.stageId]: { ...forStage, [event.artifactId]: entry },
        },
      };
    });
  },

  async hydrateFromDb(stageId) {
    const summaries = await getAgentArtifactSummaries(stageId);
    const entries: Record<string, AgentArtifactEntry> = {};
    for (const s of summaries) entries[s.artifactId] = summaryToEntry(s);
    set((state) => ({ byStage: { ...state.byStage, [stageId]: entries } }));
  },

  async getOne(stageId, artifactId) {
    const cached = get().byStage[stageId]?.[artifactId];
    if (cached?.markdown != null) return cached;
    const row = await getAgentArtifact(stageId, artifactId);
    if (!row) return cached ?? null;
    const entry = recordToEntry(row);
    set((state) => {
      const forStage = state.byStage[stageId] ?? {};
      return {
        byStage: { ...state.byStage, [stageId]: { ...forStage, [artifactId]: entry } },
      };
    });
    return entry;
  },

  clearStage(stageId) {
    set((state) => {
      if (!state.byStage[stageId]) return state;
      const next = { ...state.byStage };
      delete next[stageId];
      sortedCache.delete(stageId);
      return { byStage: next };
    });
  },
}));

/**
 * Stable-reference cache for the sidebar selector: Zustand re-runs selectors
 * on every state change, so `Object.values().sort()` alone would allocate a
 * fresh array each time and re-render every consumer. Keyed by the inner map
 * identity — replaced atomically in every state update, so reference equality
 * is a sufficient freshness check.
 */
const EMPTY_ARTIFACTS: AgentArtifactEntry[] = [];
const sortedCache = new Map<
  string,
  { source: Record<string, AgentArtifactEntry>; value: AgentArtifactEntry[] }
>();

export function selectArtifactsForStage(
  state: AgentArtifactState,
  stageId: string,
): AgentArtifactEntry[] {
  const byId = state.byStage[stageId];
  if (!byId) return EMPTY_ARTIFACTS;
  const cached = sortedCache.get(stageId);
  if (cached && cached.source === byId) return cached.value;
  const value = Object.values(byId).sort((a, b) => b.createdAt - a.createdAt);
  sortedCache.set(stageId, { source: byId, value });
  return value;
}
