/**
 * Subagent: tts-generator
 *
 * Wraps `generateTTSForClassroom`. Idempotent by content-addressed filename —
 * safe to re-run on resume. Non-fatal on error.
 */

import { generateTTSForClassroom } from '@/lib/server/classroom-media-generation';
import { createLogger } from '@/lib/logger';
import type { SubagentContext, SubagentDefinition } from '../types';
import type { GenerationAgentEvent } from '../events';
import {
  ttsGeneratorInputSchema,
  ttsGeneratorOutputSchema,
  type TTSGeneratorInput,
  type TTSGeneratorOutput,
} from '../schemas';

const log = createLogger('Subagent:TTSGenerator');

export const ttsGeneratorSubagent: SubagentDefinition<TTSGeneratorInput, TTSGeneratorOutput> = {
  id: 'tts-generator',
  label: 'TTS generator',
  description: 'Synthesizes per-speech audio for every scene that has spoken content.',
  inputSchema: ttsGeneratorInputSchema,
  outputSchema: ttsGeneratorOutputSchema,
  timeoutMs: 600000,
  async *run(
    input: TTSGeneratorInput,
    ctx: SubagentContext,
  ): AsyncGenerator<GenerationAgentEvent, TTSGeneratorOutput, void> {
    yield {
      type: 'agent.thinking',
      nodeId: ctx.nodeId,
      stage: 'generate-tts',
    };

    try {
      await generateTTSForClassroom(input.scenes, input.stageId, input.baseUrl);
      return { ok: true };
    } catch (err) {
      log.warn('TTS generation failed, continuing', err);
      return { ok: false };
    }
  },
};
