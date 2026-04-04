import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

const log = createLogger('GenerateCustomSkill');

interface CustomSkillRequest {
  skillId: string;
  systemPrompt: string;
  userPrompt: string;
  responseKey: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CustomSkillRequest;
    const { skillId, systemPrompt, userPrompt, responseKey } = body;

    if (!skillId || !systemPrompt || !userPrompt) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'skillId, systemPrompt, and userPrompt are required',
      );
    }

    const { model: languageModel } = resolveModelFromHeaders(req);

    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      `custom-skill-${skillId}`,
    );

    const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
    if (!parsed) {
      log.error(`[${skillId}] Failed to parse LLM response as JSON`);
      return apiError('GENERATION_FAILED', 500, `Failed to parse ${skillId} response`);
    }

    const output = responseKey && parsed[responseKey] ? parsed[responseKey] : parsed;

    return apiSuccess({ result: output });
  } catch (error) {
    log.error('Custom skill generation failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate custom skill content');
  }
}
