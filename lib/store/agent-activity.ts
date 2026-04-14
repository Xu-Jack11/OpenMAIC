/**
 * Zustand store — renders the generation agent activity tree in the UI.
 *
 * Consumed by the Phase C component `AgentActivityTree`; for now the store is
 * available to anyone who wants to observe generation progress via SSE. The
 * store is client-only (uses `create` from Zustand).
 *
 * Node-level event application is delegated to the shared reducer in
 * `lib/generation/agent/node-reducer.ts` so server and client trees cannot
 * drift.
 */

'use client';

import { create } from 'zustand';
import type { AgentActivityNode } from '@/lib/generation/agent/types';
import type { GenerationAgentEvent } from '@/lib/generation/agent/events';
import { applyEventToNode, nodeFromStartedEvent } from '@/lib/generation/agent/node-reducer';

interface AgentActivityState {
  nodes: Record<string, AgentActivityNode>;
  /** Node ids that have no parent (root dispatches). */
  rootIds: string[];
  /** Set when a terminal `classroom.done` is received. */
  classroomResult?: { classroomId: string; url: string; scenesCount: number };

  applyEvent(event: GenerationAgentEvent): void;
  hydrate(nodes: AgentActivityNode[]): void;
  reset(): void;
}

export const useAgentActivityStore = create<AgentActivityState>((set) => ({
  nodes: {},
  rootIds: [],

  applyEvent(event) {
    set((state) => {
      if (event.type === 'agent.started') {
        const node = nodeFromStartedEvent(event);
        const nodes = { ...state.nodes, [event.nodeId]: node };
        let rootIds = state.rootIds;
        if (node.parentId) {
          const parent = nodes[node.parentId];
          if (parent && !parent.children.includes(event.nodeId)) {
            nodes[node.parentId] = {
              ...parent,
              children: [...parent.children, event.nodeId],
            };
          }
        } else if (!rootIds.includes(event.nodeId)) {
          rootIds = [...rootIds, event.nodeId];
        }
        return { nodes, rootIds };
      }

      if (event.type === 'classroom.done') {
        return {
          classroomResult: {
            classroomId: event.classroomId,
            url: event.url,
            scenesCount: event.scenesCount,
          },
        };
      }

      if (!('nodeId' in event) || !event.nodeId) return state;
      const current = state.nodes[event.nodeId];
      if (!current) return state;
      const next = applyEventToNode(current, event);
      if (next === current) return state;
      return { nodes: { ...state.nodes, [event.nodeId]: next } };
    });
  },

  hydrate(incomingNodes) {
    set(() => {
      const nodes: Record<string, AgentActivityNode> = {};
      const rootIds: string[] = [];
      for (const n of incomingNodes) {
        nodes[n.id] = { ...n, children: [...n.children], toolCalls: [...n.toolCalls] };
        if (!n.parentId) rootIds.push(n.id);
      }
      return { nodes, rootIds, classroomResult: undefined };
    });
  },

  reset() {
    set({ nodes: {}, rootIds: [], classroomResult: undefined });
  },
}));

/** Selector helper: returns children of a given node id in declared order. */
export function selectChildren(
  state: AgentActivityState,
  parentId: string | null,
): AgentActivityNode[] {
  const ids = parentId == null ? state.rootIds : (state.nodes[parentId]?.children ?? []);
  return ids.map((id) => state.nodes[id]).filter((n): n is AgentActivityNode => Boolean(n));
}

/** Selector: true if any root node has failed. */
export function selectHasRootError(state: AgentActivityState): boolean {
  for (const id of state.rootIds) {
    if (state.nodes[id]?.status === 'failed') return true;
  }
  return false;
}

/** Selector: true if the tree has at least one node. */
export function selectHasActivity(state: AgentActivityState): boolean {
  return state.rootIds.length > 0;
}
