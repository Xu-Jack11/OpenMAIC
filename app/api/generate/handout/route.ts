import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import type { Handout } from '@/lib/types/supplementary';

const log = createLogger('GenerateHandout');

interface HandoutRequest {
  sceneData: string;
  stage: {
    name: string;
    description?: string;
    language?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as HandoutRequest;
    const { sceneData, stage } = body;

    if (!sceneData || !stage?.name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'sceneData and stage.name are required');
    }

    const { model: languageModel } = resolveModelFromHeaders(req);
    const language = stage.language || 'en-US';

    const prompts = buildPrompt(PROMPT_IDS.HANDOUT, {
      stageName: stage.name,
      stageDescription: stage.description || '',
      language,
      sceneData,
    });

    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to load handout prompt template');
    }

    const result = await callLLM(
      {
        model: languageModel,
        system: prompts.system,
        prompt: prompts.user,
      },
      'handout',
    );

    const handout = parseJsonResponse<Handout>(result.text);
    if (!handout) {
      log.error('Failed to parse handout from LLM response');
      return apiError('GENERATION_FAILED', 500, 'Failed to parse handout response');
    }

    return apiSuccess({ handout });
  } catch (error) {
    log.error('Handout generation failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate handout');
  }
}
