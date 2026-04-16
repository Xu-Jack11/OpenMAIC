import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt } from '@/lib/generation/prompts';
import type { PromptId } from '@/lib/generation/prompts/types';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { getPluginOutputSchema } from '@/lib/plugins/schemas';

const log = createLogger('GenerateSkill');

interface SkillRequest {
  skillId: string;
  promptId: string;
  variables: Record<string, string>;
  responseKey: string;
  /**
   * Optional schema id from the manifest's `generation.outputSchema`. Takes
   * precedence over the implicit `skillId` lookup when both are present —
   * lets user YAML skills opt into a built-in schema.
   */
  outputSchema?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SkillRequest;
    const { skillId, promptId, variables, responseKey, outputSchema } = body;

    if (!skillId || !promptId || !variables) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'skillId, promptId, and variables are required',
      );
    }

    const { model: languageModel } = resolveModelFromHeaders(req);

    const prompts = buildPrompt(promptId as PromptId, variables);
    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, `Failed to load prompt template: ${promptId}`);
    }

    const result = await callLLM(
      {
        model: languageModel,
        system: prompts.system,
        prompt: prompts.user,
      },
      `skill-${skillId}`,
    );

    const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
    if (!parsed) {
      log.error(`[${skillId}] Failed to parse LLM response as JSON`);
      return apiError('GENERATION_FAILED', 500, `Failed to parse ${skillId} response`);
    }

    // Extract the specific response key if present, otherwise return the whole object
    const rawOutput = responseKey && parsed[responseKey] ? parsed[responseKey] : parsed;

    // Phase D — validate against the skill's Zod schema when one is registered.
    // Resolution order: explicit `outputSchema` from the manifest, then the
    // implicit `skillId` lookup (built-in plugins). Either can match; user
    // YAML skills and unknown ids fall through unchanged.
    const schema =
      (outputSchema && getPluginOutputSchema(outputSchema)) || getPluginOutputSchema(skillId);
    if (schema) {
      const validated = schema.safeParse(rawOutput);
      if (!validated.success) {
        log.warn(`[${skillId}] output schema validation failed`, validated.error.message);
        return apiError(
          'GENERATION_FAILED',
          500,
          `Plugin "${skillId}" produced a response that failed schema validation`,
          validated.error.message,
        );
      }
      return apiSuccess({ result: validated.data });
    }

    return apiSuccess({ result: rawOutput });
  } catch (error) {
    log.error('Skill generation failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate skill content');
  }
}
