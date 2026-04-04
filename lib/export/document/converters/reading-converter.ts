import type { ExportableDocument, DocumentSection } from '../types';
import type { ExtendedReading } from '@/lib/types/supplementary';
import type { Locale } from '@/lib/i18n';
import { translate } from '@/lib/i18n';

export function convertReadingToDocument(
  reading: ExtendedReading,
  locale: Locale,
): ExportableDocument {
  const t = (key: string) => translate(locale, key);
  const sections: DocumentSection[] = [];

  sections.push({
    heading: t('supplementary.reading.topicOverview'),
    level: 2,
    paragraphs: [reading.topicOverview],
  });

  const knowledgeChildren: DocumentSection[] = reading.knowledgePoints.map((kp) => ({
    heading: kp.title,
    level: 3,
    paragraphs: [
      kp.content,
      ...(kp.connections
        ? [`${t('supplementary.reading.connectionToClassroom')}: ${kp.connections}`]
        : []),
    ],
  }));

  sections.push({
    heading: t('supplementary.reading.knowledgePoints'),
    level: 2,
    children: knowledgeChildren,
  });

  const resourceTypeLabel = (type: string) => {
    const typeKey = `supplementary.reading.type${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    const translated = t(typeKey);
    return translated !== typeKey ? translated : type;
  };

  sections.push({
    heading: t('supplementary.reading.resources'),
    level: 2,
    table: {
      headers: [
        t('supplementary.reading.resourceTitle'),
        t('supplementary.reading.resourceType'),
        t('supplementary.reading.resourceDescription'),
      ],
      rows: reading.recommendedResources.map((r) => [
        r.url ? `${r.title} (${r.url})` : r.title,
        resourceTypeLabel(r.type),
        r.description,
      ]),
    },
  });

  sections.push({
    heading: t('supplementary.reading.guidingQuestions'),
    level: 2,
    numberedItems: reading.guidingQuestions,
  });

  return {
    meta: {
      title: reading.title,
      language: locale,
    },
    sections,
  };
}
