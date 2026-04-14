/**
 * Subagent: media-generator
 *
 * Wraps `generateMediaForClassroom` + `replaceMediaPlaceholders`. Idempotent by
 * content-addressed filename — safe to re-run on resume.
 *
 * Non-fatal on error: returns `{ mediaCount: 0 }` so scene generation that
 * does not need media can still complete successfully.
 */

import {
  generateMediaForClassroom,
  replaceMediaPlaceholders,
} from '@/lib/server/classroom-media-generation';
import { createLogger } from '@/lib/logger';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  mediaGeneratorInputSchema,
  mediaGeneratorOutputSchema,
  type MediaGeneratorInput,
  type MediaGeneratorOutput,
} from '../schemas';

const log = createLogger('Subagent:MediaGenerator');

export const mediaGeneratorSubagent: SubagentDefinition<MediaGeneratorInput, MediaGeneratorOutput> =
  {
    id: 'media-generator',
    label: 'Media generator',
    description:
      'Generates images and videos referenced by scene outlines and rewrites media placeholders inside the committed scenes.',
    inputSchema: mediaGeneratorInputSchema,
    outputSchema: mediaGeneratorOutputSchema,
    timeoutMs: 600000,
    async *run(
      input: MediaGeneratorInput,
      ctx: SubagentContext,
    ): AsyncGenerator<GenerationAgentEvent, MediaGeneratorOutput, void> {
      if (!ctx.stageApi) {
        throw new Error('media-generator requires ctx.stageApi to be set');
      }

      yield {
        type: 'agent.thinking',
        nodeId: ctx.nodeId,
        stage: 'generate-media',
      };

      try {
        const mediaMap = await generateMediaForClassroom(
          input.outlines,
          input.stageId,
          input.baseUrl,
        );
        const scenesResult = ctx.stageApi.scene.list();
        const scenes = scenesResult.success && scenesResult.data ? scenesResult.data : [];
        replaceMediaPlaceholders(scenes, mediaMap);
        return { mediaCount: Object.keys(mediaMap).length };
      } catch (err) {
        log.warn('Media generation failed, continuing', err);
        return { mediaCount: 0 };
      }
    },
  };
