import { FlaskConical } from 'lucide-react';
import { getModelHeaders } from '@/lib/utils/model-config';
import { summarizeScenes } from '@/lib/utils/scene-summary';
import { convertExperimentToDocument } from '@/lib/export/document/converters/experiment-converter';
import { ExperimentPreview } from '@/components/supplementary/experiment-preview';
import { registerPlugin } from '../registry';
import type { PluginInput } from '../types';
import type { ExperimentDesign } from '@/lib/types/supplementary';

registerPlugin({
  id: 'experiment',
  icon: FlaskConical,
  i18nPrefix: 'supplementary.experiment',
  supportedFormats: ['docx', 'pdf'],

  async generate(input: PluginInput) {
    const content = summarizeScenes(input.scenes);
    const response = await fetch('/api/generate/experiment', {
      method: 'POST',
      headers: getModelHeaders(),
      body: JSON.stringify({
        topic: input.stage.name,
        content,
        language: input.stage.language || input.locale,
      }),
    });

    const data = await response.json();
    if (!data.success || !data.experiment) {
      throw new Error(data.error || 'Generation failed');
    }
    return data.experiment as ExperimentDesign;
  },

  toDocument(data, locale) {
    return convertExperimentToDocument(data as ExperimentDesign, locale);
  },

  PreviewComponent: ExperimentPreview,
});
