/**
 * Generation Agent Orchestrator — public entry point.
 *
 * Dispatches to either the deterministic Phase A planner (which mirrors the
 * legacy `generateClassroom()` pipeline) or the LLM-driven Phase B planner
 * (which uses Anthropic `tool_use` to pick the next subagent) based on the
 * `GENERATION_AGENT_MODE` environment variable.
 *
 * Both planners run their tool calls through the shared runtime in
 * `./runtime`, so every strategy reports progress through the same SSE
 * channel and respects the same timeout/validation semantics.
 */

import { createLogger } from '@/lib/logger';
import {
  ActivityTree,
  type OrchestratorEventListener,
  type OrchestratorInput,
  type OrchestratorOutput,
} from './runtime';
import { runDeterministicPlanner } from './deterministic-planner';
import { runLLMPlanner } from './llm-planner';

const log = createLogger('GenerationAgent:Orchestrator');

/** Resolves the planning strategy from the current environment. */
export type PlannerMode = 'deterministic' | 'tool_use';

export function resolvePlannerMode(): PlannerMode {
  return process.env.GENERATION_AGENT_MODE === 'tool_use' ? 'tool_use' : 'deterministic';
}

export async function runGenerationAgent(
  input: OrchestratorInput,
  options?: { onEvent?: OrchestratorEventListener; mode?: PlannerMode },
): Promise<OrchestratorOutput> {
  const tree = new ActivityTree();
  if (options?.onEvent) tree.addListener(options.onEvent);

  const mode = options?.mode ?? resolvePlannerMode();

  if (mode === 'tool_use') {
    if (!input.languageModel) {
      throw new Error(
        'runGenerationAgent: tool_use mode requires `input.languageModel` to be set.',
      );
    }
    log.info('Running generation agent in tool_use (LLM planner) mode');
    return runLLMPlanner(input, tree, {
      model: input.languageModel,
      maxOutputTokens: input.maxOutputTokens,
    });
  }

  log.info('Running generation agent in deterministic mode');
  return runDeterministicPlanner(input, tree);
}

// Re-exports for downstream consumers.
export type { AgentActivityNode } from './types';
export type { OrchestratorInput, OrchestratorOutput, OrchestratorEventListener } from './runtime';
