/**
 * Generic Converter — transforms any JSON object into ExportableDocument.
 * Used as fallback when a skill doesn't provide a custom converter.
 */

import type { ExportableDocument, DocumentSection } from '@/lib/export/document/types';
import type { Locale } from '@/lib/i18n';

export function genericToDocument(data: unknown, locale: Locale): ExportableDocument {
  if (!data || typeof data !== 'object') {
    return {
      meta: { title: 'Export', language: locale },
      sections: [{ heading: 'Content', level: 2, paragraphs: [String(data)] }],
    };
  }

  const obj = data as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title : 'Export';
  const sections: DocumentSection[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'title') continue; // Already used as document title

    if (typeof value === 'string') {
      sections.push({
        heading: formatHeading(key),
        level: 2,
        paragraphs: [value],
      });
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;

      if (value.every((v) => typeof v === 'string')) {
        sections.push({
          heading: formatHeading(key),
          level: 2,
          bulletPoints: value,
        });
      } else {
        // Array of objects — each becomes a subsection
        const children: DocumentSection[] = value.map((item, i) => {
          if (typeof item === 'string') {
            return { heading: `${i + 1}`, level: 3 as const, paragraphs: [item] };
          }
          if (typeof item === 'object' && item !== null) {
            const itemObj = item as Record<string, unknown>;
            const itemTitle =
              typeof itemObj.title === 'string'
                ? itemObj.title
                : typeof itemObj.name === 'string'
                  ? itemObj.name
                  : `${formatHeading(key)} ${i + 1}`;

            const paragraphs: string[] = [];
            const bulletPoints: string[] = [];

            for (const [k, v] of Object.entries(itemObj)) {
              if (k === 'title' || k === 'name') continue;
              if (typeof v === 'string') {
                paragraphs.push(`${formatHeading(k)}: ${v}`);
              } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
                bulletPoints.push(...v);
              }
            }

            return {
              heading: itemTitle,
              level: 3 as const,
              paragraphs: paragraphs.length > 0 ? paragraphs : undefined,
              bulletPoints: bulletPoints.length > 0 ? bulletPoints : undefined,
            };
          }
          return { heading: `${i + 1}`, level: 3 as const, paragraphs: [String(item)] };
        });

        sections.push({
          heading: formatHeading(key),
          level: 2,
          children,
        });
      }
    }
  }

  return {
    meta: { title, language: locale },
    sections,
  };
}

function formatHeading(key: string): string {
  const words = key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim()
    .split(/\s+/);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
