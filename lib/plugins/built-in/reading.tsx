import { Library } from 'lucide-react';
import { getModelHeaders } from '@/lib/utils/model-config';
import { summarizeScenes } from '@/lib/utils/scene-summary';
import { convertReadingToDocument } from '@/lib/export/document/converters/reading-converter';
import { ReadingPreview } from '@/components/supplementary/reading-preview';
import { registerPlugin } from '../registry';
import type { PluginInput } from '../types';
import type { ExtendedReading } from '@/lib/types/supplementary';

registerPlugin({
  id: 'reading',
  icon: Library,
  i18nPrefix: 'supplementary.reading',
  supportedFormats: ['docx', 'pdf', 'markdown'],

  async generate(input: PluginInput) {
    const content = summarizeScenes(input.scenes);
    const response = await fetch('/api/generate/reading', {
      method: 'POST',
      headers: getModelHeaders(),
      body: JSON.stringify({
        topic: input.stage.name,
        content,
        language: input.stage.language || input.locale,
      }),
    });

    const data = await response.json();
    if (!data.success || !data.reading) {
      throw new Error(data.error || 'Generation failed');
    }
    return data.reading as ExtendedReading;
  },

  toDocument(data, locale) {
    return convertReadingToDocument(data as ExtendedReading, locale);
  },

  PreviewComponent: ReadingPreview,
});
