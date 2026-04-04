import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import type { ExtendedReading } from '@/lib/types/supplementary';

const log = createLogger('GenerateReading');

interface ReadingRequest {
  topic: string;
  content: string;
  language?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReadingRequest;
    const { topic, content, language = 'en-US' } = body;

    if (!topic || !content) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'topic and content are required');
    }

    const { model: languageModel } = resolveModelFromHeaders(req);

    const prompts = buildPrompt(PROMPT_IDS.EXTENDED_READING, {
      topic,
      contentSummary: content,
      language,
    });

    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to load reading prompt template');
    }

    const result = await callLLM(
      {
        model: languageModel,
        system: prompts.system,
        prompt: prompts.user,
      },
      'extended-reading',
    );

    const reading = parseJsonResponse<ExtendedReading>(result.text);
    if (!reading) {
      log.error('Failed to parse reading material from LLM response');
      return apiError('GENERATION_FAILED', 500, 'Failed to parse reading response');
    }

    return apiSuccess({ reading });
  } catch (error) {
    log.error('Extended reading generation failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate extended reading');
  }
}
