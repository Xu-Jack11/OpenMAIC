import type { ExportableDocument, DocumentSection } from '../types';
import type { ExperimentDesign } from '@/lib/types/supplementary';
import type { Locale } from '@/lib/i18n';
import { translate } from '@/lib/i18n';

export function convertExperimentToDocument(
  experiment: ExperimentDesign,
  locale: Locale,
): ExportableDocument {
  const t = (key: string) => translate(locale, key);
  const sections: DocumentSection[] = [];

  sections.push({
    heading: t('supplementary.experiment.purpose'),
    level: 2,
    paragraphs: [experiment.purpose],
  });

  sections.push({
    heading: t('supplementary.experiment.materials'),
    level: 2,
    table: {
      headers: [
        t('supplementary.experiment.materialName'),
        t('supplementary.experiment.materialQty'),
        t('supplementary.experiment.materialNotes'),
      ],
      rows: experiment.materials.map((m) => [m.name, m.quantity, m.notes || '']),
    },
  });

  sections.push({
    heading: t('supplementary.experiment.steps'),
    level: 2,
    numberedItems: experiment.steps.map((s) => {
      const parts = [s.instruction];
      if (s.duration) parts.push(`(${s.duration})`);
      if (s.tips) parts.push(`— ${s.tips}`);
      return parts.join(' ');
    }),
  });

  sections.push({
    heading: t('supplementary.experiment.safety'),
    level: 2,
    bulletPoints: experiment.safetyNotes,
  });

  sections.push({
    heading: t('supplementary.experiment.expectedResults'),
    level: 2,
    paragraphs: [experiment.expectedResults],
  });

  sections.push({
    heading: t('supplementary.experiment.thinkingQuestions'),
    level: 2,
    numberedItems: experiment.thinkingQuestions,
  });

  return {
    meta: {
      title: experiment.title,
      subtitle: experiment.subject,
      language: locale,
    },
    sections,
  };
}
