/**
 * Multi-format export for agent-generated markdown artifacts.
 *
 * The existing pipeline (`lib/export/document/`) operates on a structured
 * `ExportableDocument`; this module bridges raw markdown (what the agent
 * produces) into that shape and dispatches to the appropriate builder.
 *
 * The builders are imported lazily inside each branch — `html2pdf`, `docx`,
 * and `file-saver` touch `window`/`document`, so keeping them off the static
 * import graph keeps Next.js SSR off the hot path.
 *
 * The markdown parser handles ATX headings, bulleted + numbered lists, pipe
 * tables and prose. Richer syntax (fenced code, blockquotes, inline emphasis)
 * falls through as plain paragraphs — acceptable for classroom artifacts,
 * where headings + lists + tables carry the meaning.
 */

import type {
  DocumentSection,
  ExportFormat,
  ExportableDocument,
} from '@/lib/export/document/types';

type Locale = 'zh-CN' | 'en-US';

/** Filename-safe slug derived from an artifact title. */
export function slugifyTitle(title: string, fallback = 'artifact'): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : fallback;
}

type ListField = 'bulletPoints' | 'numberedItems';

/**
 * Parse a markdown string into the format-agnostic `ExportableDocument`
 * shape. First `#` heading becomes the document title; subsequent headings
 * open new sections. Content under a heading is bucketed by list type.
 */
export function markdownToExportableDocument(
  markdown: string,
  locale: Locale,
  fallbackTitle: string,
): ExportableDocument {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  let title = fallbackTitle;
  const sections: DocumentSection[] = [];

  let current: DocumentSection | null = null;
  let paragraphBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const ensureCurrent = (): DocumentSection => {
    if (!current) {
      current = { heading: fallbackTitle, level: 2 };
      sections.push(current);
    }
    return current;
  };

  const appendToList = (field: ListField, text: string) => {
    const section = ensureCurrent();
    (section[field] ??= []).push(text);
  };

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    paragraphBuffer = [];
    if (!text) return;
    const section = ensureCurrent();
    (section.paragraphs ??= []).push(text);
  };

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      for (const line of tableBuffer) paragraphBuffer.push(line);
      tableBuffer = [];
      flushParagraph();
      return;
    }
    const parseRow = (raw: string): string[] =>
      raw
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => c.trim());
    const headers = parseRow(tableBuffer[0]);
    const rows = tableBuffer.slice(2).map(parseRow);
    tableBuffer = [];
    const section = ensureCurrent();
    if (!section.table) {
      section.table = { headers, rows };
      return;
    }
    const nextLevel = Math.min(4, section.level + 1) as 2 | 3 | 4;
    (section.children ??= []).push({ heading: '', level: nextLevel, table: { headers, rows } });
  };

  const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
  const isTableSeparator = (line: string) =>
    /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (isTableLine(line) || (tableBuffer.length === 1 && isTableSeparator(line))) {
      flushParagraph();
      tableBuffer.push(line);
      continue;
    } else if (tableBuffer.length > 0) {
      flushTable();
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      const rawLevel = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (rawLevel === 1 && sections.length === 0 && !current) {
        title = text || fallbackTitle;
        continue;
      }
      const level = (rawLevel === 1 ? 2 : Math.min(4, rawLevel)) as 2 | 3 | 4;
      current = { heading: text, level };
      sections.push(current);
      continue;
    }

    const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      flushParagraph();
      appendToList('bulletPoints', stripInline(bulletMatch[1]));
      continue;
    }

    const numberedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numberedMatch) {
      flushParagraph();
      appendToList('numberedItems', stripInline(numberedMatch[1]));
      continue;
    }

    paragraphBuffer.push(stripInline(line.trim()));
  }

  if (tableBuffer.length > 0) flushTable();
  flushParagraph();

  if (sections.length === 0) {
    sections.push({ heading: fallbackTitle, level: 2, paragraphs: [] });
  }

  return {
    meta: { title, language: locale, date: new Date().toISOString().slice(0, 10) },
    sections,
  };
}

function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
}

/**
 * Export an artifact to the requested format and trigger a browser download.
 * Reuses the shared builders in `lib/export/document/*` so DOCX/PDF styling
 * matches the rest of the app.
 */
export async function exportArtifact(
  args: { title: string; markdown: string; locale: Locale },
  format: ExportFormat,
): Promise<void> {
  const { title, markdown, locale } = args;
  const filename = slugifyTitle(title);

  const { blob, ext } = await buildBlob(markdown, locale, title, format);
  const { saveAs } = await import('file-saver');
  saveAs(blob, `${filename}.${ext}`);
}

async function buildBlob(
  markdown: string,
  locale: Locale,
  title: string,
  format: ExportFormat,
): Promise<{ blob: Blob; ext: string }> {
  if (format === 'markdown') {
    return {
      blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      ext: 'md',
    };
  }
  const doc = markdownToExportableDocument(markdown, locale, title);
  if (format === 'docx') {
    const { buildDocx } = await import('@/lib/export/document/docx-builder');
    return { blob: await buildDocx(doc), ext: 'docx' };
  }
  const { buildPdf } = await import('@/lib/export/document/pdf-builder');
  return { blob: buildPdf(doc), ext: 'pdf' };
}
