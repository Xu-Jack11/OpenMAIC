/**
 * Skill Loader — converts SkillManifest[] into registered GenerationPlugins.
 *
 * Import this module (side-effect) to register all skills:
 *   import '@/lib/plugins/skill-loader';
 */

import { resolveIcon } from './icon-resolver';
import { registerPlugin } from './registry';
import { getModelHeaders } from '@/lib/utils/model-config';
import { summarizeScenes } from '@/lib/utils/scene-summary';
import { genericToDocument } from './generic-converter';
import { GenericPreview } from './generic-preview';
import type { PluginInput, GenerationPlugin } from './types';
import type { ExportableDocument } from '@/lib/export/document/types';
import type { Locale } from '@/lib/i18n';
import type { SkillManifest } from './skill-manifest';

// ── Custom preview components (lazy-loaded by name) ──
import { HandoutPreview } from '@/components/supplementary/handout-preview';
import { ExperimentPreview } from '@/components/supplementary/experiment-preview';
import { ReadingPreview } from '@/components/supplementary/reading-preview';

const PREVIEW_MAP: Record<string, React.ComponentType<{ data: unknown }>> = {
  'handout-preview': HandoutPreview,
  'experiment-preview': ExperimentPreview,
  'reading-preview': ReadingPreview,
};

// ── Custom converters (loaded by name) ──
import { convertHandoutToDocument } from '@/lib/export/document/converters/handout-converter';
import { convertExperimentToDocument } from '@/lib/export/document/converters/experiment-converter';
import { convertReadingToDocument } from '@/lib/export/document/converters/reading-converter';

const CONVERTER_MAP: Record<
  string,
  (data: unknown, locale: Locale) => ExportableDocument
> = {
  'handout-converter': (data, locale) =>
    convertHandoutToDocument(data as Parameters<typeof convertHandoutToDocument>[0], locale),
  'experiment-converter': (data, locale) =>
    convertExperimentToDocument(
      data as Parameters<typeof convertExperimentToDocument>[0],
      locale,
    ),
  'reading-converter': (data, locale) =>
    convertReadingToDocument(data as Parameters<typeof convertReadingToDocument>[0], locale),
};

// ── Variable resolver ──
function resolveVariables(
  mapping: Record<string, string>,
  input: PluginInput,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [templateVar, source] of Object.entries(mapping)) {
    switch (source) {
      case 'stage.name':
        vars[templateVar] = input.stage.name;
        break;
      case 'stage.description':
        vars[templateVar] = input.stage.description || '';
        break;
      case 'stage.language':
        vars[templateVar] = input.stage.language || input.locale;
        break;
      case 'sceneSummary':
        vars[templateVar] = summarizeScenes(input.scenes);
        break;
      default:
        vars[templateVar] = source; // literal value
    }
  }
  return vars;
}

// ── Build GenerationPlugin from SkillManifest ──
function buildPlugin(manifest: SkillManifest): GenerationPlugin {
  const icon = resolveIcon(manifest.icon);
  const PreviewComponent =
    (manifest.preview?.component && PREVIEW_MAP[manifest.preview.component]) || GenericPreview;
  const converter =
    manifest.export?.converter && CONVERTER_MAP[manifest.export.converter];

  return {
    id: manifest.id,
    icon,
    i18nPrefix: manifest.i18nPrefix,
    supportedFormats: manifest.supportedFormats,

    async generate(input: PluginInput) {
      const variables = resolveVariables(manifest.generation.variables, input);
      const response = await fetch('/api/generate/skill', {
        method: 'POST',
        headers: getModelHeaders(),
        body: JSON.stringify({
          skillId: manifest.id,
          promptId: manifest.generation.promptId,
          variables,
          responseKey: manifest.generation.responseKey,
        }),
      });

      const data = await response.json();
      if (!data.success || !data.result) {
        throw new Error(data.error || 'Generation failed');
      }
      return data.result;
    },

    toDocument(data, locale) {
      if (converter) return converter(data, locale);
      return genericToDocument(data, locale);
    },

    PreviewComponent,

    getOutlineGuidance(language: string) {
      if (!manifest.guidance) return null;
      return manifest.guidance[language] || manifest.guidance['en-US'] || null;
    },
  };
}

// ── Exported async loader ──
export async function loadSkills(): Promise<GenerationPlugin[]> {
  try {
    const res = await fetch('/api/skills/list');
    if (!res.ok) {
      throw new Error('Failed to fetch skills');
    }
    
    const data = await res.json() as { skills: SkillManifest[] };
    const manifests = data.skills || [];
    
    const loadedPlugins = manifests.map(buildPlugin);
    
    // Also update the synchronous registry for non-React contexts
    loadedPlugins.forEach(registerPlugin);
    
    return loadedPlugins;
  } catch (error) {
    console.error('Error loading skills via API:', error);
    return [];
  }
}
