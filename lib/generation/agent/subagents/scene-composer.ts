/**
 * Subagent: scene-composer
 *
 * Writes a fully-assembled scene into the shared stage store via
 * `createSceneWithActions`. Not an LLM call — kept as a subagent so every
 * scene's lifecycle is visible in the activity tree.
 */

import { createSceneWithActions } from '@/lib/generation/scene-generator';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  sceneComposerInputSchema,
  sceneComposerOutputSchema,
  type SceneComposerInput,
  type SceneComposerOutput,
} from '../schemas';

export const sceneComposerSubagent: SubagentDefinition<SceneComposerInput, SceneComposerOutput> = {
  id: 'scene-composer',
  label: 'Scene composer',
  description:
    'Assembles the generated content and actions into a Scene and commits it to the stage store.',
  inputSchema: sceneComposerInputSchema,
  outputSchema: sceneComposerOutputSchema,
  timeoutMs: 5000,
  async *run(
    input: SceneComposerInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, SceneComposerOutput, void> {
    if (!ctx.stageApi) {
      throw new Error('scene-composer requires ctx.stageApi to be set');
    }

    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'compose-scene',
    };

    const sceneId = createSceneWithActions(
      input.outline,
      input.content,
      input.actions,
      ctx.stageApi,
    );
    return { sceneId: sceneId ?? null };
  },
};
