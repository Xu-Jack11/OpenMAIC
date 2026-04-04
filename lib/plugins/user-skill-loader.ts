/**
 * User Skill Loader — converts IndexedDB UserSkillRecords into GenerationPlugins.
 *
 * Custom skills use:
 *  - Client-side prompt interpolation (no filesystem templates)
 *  - GenericPreview for rendering
 *  - genericToDocument for export
 */

import { resolveIcon } from './icon-resolver';
import { interpolatePrompt } from './prompt-interpolation';
import { genericToDocument } from './generic-converter';
import { GenericPreview } from './generic-preview';
import { getModelHeaders } from '@/lib/utils/model-config';
import { summarizeScenes } from '@/lib/utils/scene-summary';
import { getUserSkills } from '@/lib/utils/database';
import type { PluginInput, GenerationPlugin } from './types';
import type { UserSkill, UserSkillVariable } from './user-skill';

/**
 * Resolve variable values from PluginInput based on UserSkillVariable definitions.
 */
function resolveUserVariables(
  variables: UserSkillVariable[],
  input: PluginInput,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const v of variables) {
    switch (v.source) {
      case 'stage.name':
        vars[v.templateVar] = input.stage.name;
        break;
      case 'stage.description':
        vars[v.templateVar] = input.stage.description || '';
        break;
      case 'stage.language':
        vars[v.templateVar] = input.stage.language || input.locale;
        break;
      case 'sceneSummary':
        vars[v.templateVar] = summarizeScenes(input.scenes);
        break;
    }
  }
  return vars;
}

/**
 * Build a GenerationPlugin from a UserSkill record.
 */
function buildUserPlugin(skill: UserSkill): GenerationPlugin {
  const icon = resolveIcon(skill.icon);

  return {
    id: skill.id,
    icon,
    i18nPrefix: `__custom__.${skill.id}`,
    displayName: skill.name,
    displayDescription: skill.description,
    isCustom: true,
    supportedFormats: skill.supportedFormats,

    async generate(input: PluginInput) {
      const variables = resolveUserVariables(skill.variables, input);
      const systemPrompt = interpolatePrompt(skill.systemPrompt, variables);
      const userPrompt = interpolatePrompt(skill.userPrompt, variables);

      const response = await fetch('/api/generate/custom-skill', {
        method: 'POST',
        headers: getModelHeaders(),
        body: JSON.stringify({
          skillId: skill.id,
          systemPrompt,
          userPrompt,
          responseKey: skill.responseKey,
        }),
      });

      const data = await response.json();
      if (!data.success || !data.result) {
        throw new Error(data.error || 'Generation failed');
      }
      return data.result;
    },

    toDocument(data, locale) {
      return genericToDocument(data, locale);
    },

    PreviewComponent: GenericPreview,

    getOutlineGuidance() {
      return skill.guidance || null;
    },
  };
}

/**
 * Load all user-defined skills from IndexedDB and convert to GenerationPlugins.
 */
export async function loadUserSkillPlugins(): Promise<GenerationPlugin[]> {
  try {
    const records = await getUserSkills();
    return records.map((record) => {
      const skill: UserSkill = {
        ...record,
        variables: JSON.parse(record.variables),
        supportedFormats: JSON.parse(record.supportedFormats),
      };
      return buildUserPlugin(skill);
    });
  } catch (error) {
    console.error('Error loading user skills:', error);
    return [];
  }
}
