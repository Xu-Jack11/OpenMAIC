/**
 * User-defined skill types.
 *
 * These skills are created by end-users through the UI and stored in IndexedDB.
 * Unlike built-in skills (YAML manifests on disk), user skills carry inline prompts.
 */

import type { ExportFormat } from '@/lib/export/document/types';

export type UserSkillVariableSource =
  | 'stage.name'
  | 'stage.description'
  | 'stage.language'
  | 'sceneSummary';

export interface UserSkillVariable {
  /** Variable name used in the prompt template, e.g. 'courseName' */
  templateVar: string;
  /** Data source for this variable */
  source: UserSkillVariableSource;
}

export interface UserSkill {
  /** Unique ID prefixed with 'custom-', e.g. 'custom-abc123' */
  id: string;
  /** User-provided display name */
  name: string;
  /** User-provided description */
  description: string;
  /** Lucide icon name, e.g. 'Sparkles' */
  icon: string;
  /** System prompt template with {{variable}} placeholders */
  systemPrompt: string;
  /** User prompt template with {{variable}} placeholders */
  userPrompt: string;
  /** Enabled variables for prompt interpolation */
  variables: UserSkillVariable[];
  /** JSON key to extract from LLM response (empty = use full response) */
  responseKey: string;
  /** Supported export formats */
  supportedFormats: ExportFormat[];
  /** Optional outline generation guidance text */
  guidance?: string;
  createdAt: number;
  updatedAt: number;
}

/** Default variables available to user-defined skills */
export const USER_SKILL_VARIABLE_OPTIONS: {
  templateVar: string;
  source: UserSkillVariableSource;
  i18nKey: string;
}[] = [
  { templateVar: 'courseName', source: 'stage.name', i18nKey: 'customSkill.varCourseName' },
  {
    templateVar: 'courseDescription',
    source: 'stage.description',
    i18nKey: 'customSkill.varCourseDesc',
  },
  { templateVar: 'language', source: 'stage.language', i18nKey: 'customSkill.varLanguage' },
  { templateVar: 'sceneData', source: 'sceneSummary', i18nKey: 'customSkill.varSceneData' },
];
