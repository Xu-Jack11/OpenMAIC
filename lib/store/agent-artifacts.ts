/**
 * Zustand store for agent-generated artifact metadata.
 *
 * Populated from two sources:
 *
 *   1. Live SSE `agent.artifact_created` events (via {@link ingestEvent}) — set
 *      during an active generation.
 *   2. IndexedDB hydration on stage mount (via {@link hydrateFromDb}) — used on
 *      page refresh so the Files sidebar shows previously-generated artifacts.
 *
 * The store holds only metadata. Full markdown is fetched lazily via
 * {@link getOne} (reading IndexedDB) when the user opens the preview dialog or
 * triggers a download, so large documents do not bloat the in-memory tree.
 */

'use client';

import { create } from 'zustand';
import {
  getAgentArtifact,
  getAgentArtifacts,
  type AgentArtifactRecord,
} from '@/lib/utils/database';

export interface AgentArtifactEntry {
  stageId: string;
  artifactId: string;
  kind: 'outline' | 'document';
  title: string;
  /** Full markdown, hydrated lazily. `null` until fetched from IndexedDB. */
  markdown: string | null;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
}

interface AgentArtifactState {
  /** artifactId -> entry, scoped by stageId in an outer map. */
  byStage: Record<string, Record<string, AgentArtifactEntry>>;

  ingestEvent(event: {
    stageId: string;
    artifactId: string;
    kind: 'outline' | 'document';
    title: string;
    byteSize: number;
    timestamp?: number;
  }): void;

  hydrateFromDb(stageId: string): Promise<void>;

  getOne(stageId: string, artifactId: string): Promise<AgentArtifactEntry | null>;

  clearStage(stageId: string): void;
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
      const entry: AgentArtifactEntry = {
        stageId: event.stageId,
        artifactId: event.artifactId,
        kind: event.kind,
        title: event.title,
        // Full markdown is fetched lazily — the event only carries a preview.
        markdown: null,
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
    const rows = await getAgentArtifacts(stageId);
    const entries: Record<string, AgentArtifactEntry> = {};
    for (const r of rows) entries[r.artifactId] = recordToEntry(r);
    set((state) => ({
      byStage: { ...state.byStage, [stageId]: entries },
    }));
  },

  async getOne(stageId, artifactId) {
    const cached = get().byStage[stageId]?.[artifactId];
    if (cached && cached.markdown !== null) return cached;
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
      return { byStage: next };
    });
  },
}));

/** Selector: sorted list of artifacts for a stage (newest first). */
export function selectArtifactsForStage(
  state: AgentArtifactState,
  stageId: string,
): AgentArtifactEntry[] {
  const byId = state.byStage[stageId];
  if (!byId) return [];
  return Object.values(byId).sort((a, b) => b.createdAt - a.createdAt);
}
