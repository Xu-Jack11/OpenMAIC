import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt } from '@/lib/generation/prompts';
import type { PromptId } from '@/lib/generation/prompts/types';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

const log = createLogger('GenerateSkillDefinition');

type SkillDefinitionRequest =
  | { mode: 'description'; description: string; language: string }
  | { mode: 'template'; templateText: string; language: string };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SkillDefinitionRequest;

    if (!body.mode || !body.language) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'mode and language are required');
    }

    let promptId: PromptId;
    let variables: Record<string, string>;

    if (body.mode === 'description') {
      if (!body.description) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'description is required');
      }
      promptId = 'skill-from-description';
      variables = { description: body.description, language: body.language };
    } else if (body.mode === 'template') {
      if (!body.templateText) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'templateText is required');
      }
      promptId = 'skill-from-template';
      variables = { templateText: body.templateText, language: body.language };
    } else {
      return apiError('INVALID_REQUEST', 400, 'mode must be "description" or "template"');
    }

    const { model: languageModel } = resolveModelFromHeaders(req);

    const prompts = buildPrompt(promptId, variables);
    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, `Failed to load prompt template: ${promptId}`);
    }

    const result = await callLLM(
      {
        model: languageModel,
        system: prompts.system,
        prompt: prompts.user,
      },
      `skill-definition-${body.mode}`,
    );

    const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
    if (!parsed) {
      log.error(`Failed to parse skill definition response as JSON`);
      return apiError('GENERATION_FAILED', 500, 'Failed to parse skill definition');
    }

    return apiSuccess({ definition: parsed });
  } catch (error) {
    log.error('Skill definition generation failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate skill definition');
  }
}
