import type { ExportableDocument, DocumentSection } from '../types';
import type { Handout } from '@/lib/types/supplementary';
import type { Locale } from '@/lib/i18n';
import { translate } from '@/lib/i18n';

export function convertHandoutToDocument(handout: Handout, locale: Locale): ExportableDocument {
  const t = (key: string) => translate(locale, key);
  const sections: DocumentSection[] = [];

  sections.push({
    heading: t('supplementary.handout.overview'),
    level: 2,
    paragraphs: [handout.overview],
  });

  for (const section of handout.sections) {
    const children: DocumentSection[] = [];

    if (section.keyPoints.length > 0) {
      children.push({
        heading: t('supplementary.handout.keyPoints'),
        level: 3,
        bulletPoints: section.keyPoints,
      });
    }

    if (section.notes) {
      children.push({
        heading: t('supplementary.handout.notes'),
        level: 3,
        paragraphs: [section.notes],
      });
    }

    if (section.questions?.length) {
      children.push({
        heading: t('supplementary.handout.practiceQuestions'),
        level: 3,
        numberedItems: section.questions.map((q) => {
          const parts = [q.question];
          if (q.options) parts.push(q.options.join('  '));
          if (q.answer) parts.push(`${t('supplementary.handout.answer')}: ${q.answer}`);
          if (q.analysis) parts.push(`${t('supplementary.handout.analysis')}: ${q.analysis}`);
          return parts.join('\n');
        }),
      });
    }

    sections.push({
      heading: section.title,
      level: 2,
      children,
    });
  }

  sections.push({
    heading: t('supplementary.handout.summary'),
    level: 2,
    paragraphs: [handout.summary],
  });

  return {
    meta: {
      title: handout.title,
      language: locale,
    },
    sections,
  };
}
