import { BookOpen } from 'lucide-react';
import { getModelHeaders } from '@/lib/utils/model-config';
import { summarizeScenes } from '@/lib/utils/scene-summary';
import { convertHandoutToDocument } from '@/lib/export/document/converters/handout-converter';
import { HandoutPreview } from '@/components/supplementary/handout-preview';
import { registerPlugin } from '../registry';
import type { PluginInput } from '../types';
import type { Handout } from '@/lib/types/supplementary';

registerPlugin({
  id: 'handout',
  icon: BookOpen,
  i18nPrefix: 'supplementary.handout',
  supportedFormats: ['docx', 'pdf', 'markdown'],

  async generate(input: PluginInput) {
    const sceneData = summarizeScenes(input.scenes);
    const response = await fetch('/api/generate/handout', {
      method: 'POST',
      headers: getModelHeaders(),
      body: JSON.stringify({
        sceneData,
        stage: {
          name: input.stage.name,
          description: input.stage.description,
          language: input.stage.language || input.locale,
        },
      }),
    });

    const data = await response.json();
    if (!data.success || !data.handout) {
      throw new Error(data.error || 'Generation failed');
    }
    return data.handout as Handout;
  },

  toDocument(data, locale) {
    return convertHandoutToDocument(data as Handout, locale);
  },

  PreviewComponent: HandoutPreview,
});
