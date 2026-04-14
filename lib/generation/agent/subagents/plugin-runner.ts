/**
 * Subagent: plugin-runner (Phase A stub)
 *
 * Placeholder subagent reserving the slot in the activity tree for Phase D,
 * when plugins (handout, experiment, extended-reading, user YAML skills) will
 * be executed server-side as part of classroom generation.
 *
 * In Phase A this is a no-op: plugins continue to auto-generate client-side
 * via `lib/plugins/plugin-auto-generator.ts`. The subagent returns an empty
 * executed list so the orchestrator can still show a node in the UI.
 */

import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  pluginRunnerInputSchema,
  pluginRunnerOutputSchema,
  type PluginRunnerInput,
  type PluginRunnerOutput,
} from '../schemas';

export const pluginRunnerSubagent: SubagentDefinition<PluginRunnerInput, PluginRunnerOutput> = {
  id: 'plugin-runner',
  label: 'Plugin runner',
  description:
    'Placeholder for server-side execution of supplementary-material plugins. In Phase A plugins continue to run client-side; this subagent is a no-op.',
  inputSchema: pluginRunnerInputSchema,
  outputSchema: pluginRunnerOutputSchema,
  timeoutMs: 1000,
  async *run(
    _input: PluginRunnerInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, PluginRunnerOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'plugin-runner-stub',
    };
    return { executed: [] };
  },
};
