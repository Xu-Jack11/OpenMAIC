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

  getOutlineGuidance(language) {
    return language === 'zh-CN'
      ? '实验方案插件已启用。在涉及可实验验证的知识点时，请在 description 或 keyPoints 中提及实验方法或可观测现象。'
      : 'Experiment plugin is enabled. When covering concepts that can be experimentally verified, mention experimental methods or observable phenomena in the description or keyPoints.';
  },
});
