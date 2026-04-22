/**
 * Subagent: scene-action-generator
 *
 * Wraps `generateSceneActions` — produces the ordered action array for a
 * scene, given its content and agents.
 */

import { generateSceneActions } from '@/lib/generation/scene-generator';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  sceneActionGeneratorInputSchema,
  sceneActionGeneratorOutputSchema,
  type SceneActionGeneratorInput,
  type SceneActionGeneratorOutput,
} from '../schemas';

export const sceneActionGeneratorSubagent: SubagentDefinition<
  SceneActionGeneratorInput,
  SceneActionGeneratorOutput
> = {
  id: 'scene-action-generator',
  label: 'Scene action generator',
  description:
    'Emits the ordered sequence of classroom actions (speech, whiteboard ops, spotlight, laser, etc.) for a single scene.',
  inputSchema: sceneActionGeneratorInputSchema,
  outputSchema: sceneActionGeneratorOutputSchema,
  timeoutMs: 240000,
  async *run(
    input: SceneActionGeneratorInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, SceneActionGeneratorOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'generate-actions',
    };

    const actions = await generateSceneActions(
      input.outline,
      input.content,
      ctx.aiCall,
      undefined,
      input.agents,
    );

    return { actions };
  },
};
