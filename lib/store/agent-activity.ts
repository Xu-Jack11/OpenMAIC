/**
 * Zustand store — renders the generation agent activity tree in the UI.
 *
 * Consumed by the Phase C component `AgentActivityTree`; for now the store is
 * available to anyone who wants to observe generation progress via SSE. The
 * store is client-only (uses `create` from Zustand).
 */

'use client';

import { create } from 'zustand';
import type { AgentActivityNode } from '@/lib/generation/agent/types';
import type { GenerationAgentEvent } from '@/lib/generation/agent/events';

interface AgentActivityState {
  nodes: Record<string, AgentActivityNode>;
  /** Node ids that have no parent (root dispatches). */
  rootIds: string[];
  /** True once any `agent.started` has been observed. */
  hasActivity: boolean;
  /** Set when a terminal `classroom.done` is received. */
  classroomResult?: { classroomId: string; url: string; scenesCount: number };
  /** True when the generation has failed (at least one `agent.failed` at root). */
  hasError: boolean;

  applyEvent(event: GenerationAgentEvent): void;
  hydrate(nodes: AgentActivityNode[]): void;
  reset(): void;
}

function ensureNode(state: AgentActivityState, id: string): AgentActivityNode | undefined {
  return state.nodes[id];
}

export const useAgentActivityStore = create<AgentActivityState>((set) => ({
  nodes: {},
  rootIds: [],
  hasActivity: false,
  hasError: false,

  applyEvent(event) {
    set((state) => {
      const nodes = { ...state.nodes };
      let rootIds = state.rootIds;
      let hasActivity = state.hasActivity;
      let hasError = state.hasError;
      let classroomResult = state.classroomResult;

      switch (event.type) {
        case 'agent.started': {
          const node: AgentActivityNode = {
            id: event.nodeId,
            parentId: event.parentId ?? null,
            subagentId: event.subagentId,
            label: event.label,
            status: 'running',
            startedAt: event.timestamp ?? Date.now(),
            children: [],
            toolCalls: [],
            inputSummary: event.inputSummary,
          };
          nodes[event.nodeId] = node;
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
          hasActivity = true;
          break;
        }
        case 'agent.completed': {
          const n = ensureNode(state, event.nodeId);
          if (n) {
            nodes[event.nodeId] = {
              ...n,
              status: 'succeeded',
              completedAt: event.timestamp ?? Date.now(),
              outputSummary: event.outputSummary,
            };
          }
          break;
        }
        case 'agent.failed': {
          const n = ensureNode(state, event.nodeId);
          if (n) {
            nodes[event.nodeId] = {
              ...n,
              status: 'failed',
              completedAt: event.timestamp ?? Date.now(),
              error: event.error,
            };
          }
          if (!n?.parentId) hasError = true;
          break;
        }
        case 'agent.tool_call': {
          const n = ensureNode(state, event.nodeId);
          if (n) {
            nodes[event.nodeId] = {
              ...n,
              toolCalls: [
                ...n.toolCalls,
                {
                  id: event.toolCallId,
                  name: event.toolName,
                  status: 'running',
                  argsPreview: event.argsPreview,
                },
              ],
            };
          }
          break;
        }
        case 'agent.tool_result': {
          const n = ensureNode(state, event.nodeId);
          if (n) {
            nodes[event.nodeId] = {
              ...n,
              toolCalls: n.toolCalls.map((t) =>
                t.id === event.toolCallId
                  ? {
                      ...t,
                      status: event.ok ? 'succeeded' : 'failed',
                      resultSummary: event.summary,
                    }
                  : t,
              ),
            };
          }
          break;
        }
        case 'agent.text_delta': {
          const n = ensureNode(state, event.nodeId);
          if (n) {
            const next = (n.textPreview ?? '') + event.delta;
            nodes[event.nodeId] = {
              ...n,
              textPreview: next.length > 500 ? next.slice(-500) : next,
            };
          }
          break;
        }
        case 'classroom.done':
          classroomResult = {
            classroomId: event.classroomId,
            url: event.url,
            scenesCount: event.scenesCount,
          };
          break;
        default:
          break;
      }

      return { nodes, rootIds, hasActivity, hasError, classroomResult };
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
      return {
        nodes,
        rootIds,
        hasActivity: incomingNodes.length > 0,
        hasError: incomingNodes.some((n) => !n.parentId && n.status === 'failed'),
        classroomResult: undefined,
      };
    });
  },

  reset() {
    set({
      nodes: {},
      rootIds: [],
      hasActivity: false,
      hasError: false,
      classroomResult: undefined,
    });
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
