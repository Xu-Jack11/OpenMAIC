import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import type { ExperimentDesign } from '@/lib/types/supplementary';

const log = createLogger('GenerateExperiment');

interface ExperimentRequest {
  topic: string;
  content: string;
  language?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExperimentRequest;
    const { topic, content, language = 'en-US' } = body;

    if (!topic || !content) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'topic and content are required');
    }

    const { model: languageModel } = resolveModelFromHeaders(req);

    const prompts = buildPrompt(PROMPT_IDS.EXPERIMENT_DESIGN, {
      topic,
      contentSummary: content,
      language,
    });

    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to load experiment prompt template');
    }

    const result = await callLLM(
      {
        model: languageModel,
        system: prompts.system,
        prompt: prompts.user,
      },
      'experiment-design',
    );

    const experiment = parseJsonResponse<ExperimentDesign>(result.text);
    if (!experiment) {
      log.error('Failed to parse experiment design from LLM response');
      return apiError('GENERATION_FAILED', 500, 'Failed to parse experiment response');
    }

    return apiSuccess({ experiment });
  } catch (error) {
    log.error('Experiment design generation failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate experiment design');
  }
}
