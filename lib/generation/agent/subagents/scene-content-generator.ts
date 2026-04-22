/**
 * Subagent: scene-content-generator
 *
 * Wraps `generateSceneContent` — one invocation per outline.
 */

import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  sceneContentGeneratorInputSchema,
  sceneContentGeneratorOutputSchema,
  type SceneContentGeneratorInput,
  type SceneContentGeneratorOutput,
} from '../schemas';

export const sceneContentGeneratorSubagent: SubagentDefinition<
  SceneContentGeneratorInput,
  SceneContentGeneratorOutput
> = {
  id: 'scene-content-generator',
  label: 'Scene content generator',
  description:
    'Generates the body of a single scene — slide elements, quiz questions, interactive HTML, or PBL config — from a scene outline.',
  inputSchema: sceneContentGeneratorInputSchema,
  outputSchema: sceneContentGeneratorOutputSchema,
  timeoutMs: 240000,
  async *run(
    input: SceneContentGeneratorInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, SceneContentGeneratorOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'generate-content',
    };

    const content = await generateSceneContent(
      input.outline,
      ctx.aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      input.agents,
    );

    return content;
  },
};
