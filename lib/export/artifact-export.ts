/**
 * Multi-format export for agent-generated markdown artifacts.
 *
 * The existing document export pipeline (`lib/export/document/`) works on a
 * structured `ExportableDocument`; this module bridges raw markdown (what the
 * agent produces) to that shape, then dispatches to the appropriate builder.
 *
 * Supported formats: `.md` (raw), `.docx` (via `docx` package), `.pdf` (via
 * jsPDF). The builders are imported lazily inside each branch so Next.js SSR
 * does not pull in `window`/`document`-dependent code during the build.
 *
 * Keep the parser intentionally narrow: the agent's markdown stays close to
 * the common subset (ATX headings, bulleted + numbered lists, pipe tables,
 * prose paragraphs). Features beyond that (code fences, blockquotes, inline
 * emphasis spans) fall through as plain paragraphs — acceptable fidelity loss
 * for classroom artifacts, where headings + lists + tables carry the meaning.
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

/**
 * Parse a markdown string into the format-agnostic `ExportableDocument`
 * shape expected by the shared builders. The first `# Heading` is consumed as
 * the document title; subsequent headings open new sections. Content under a
 * heading is bucketed by list type.
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

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    paragraphBuffer = [];
    if (!text) return;
    if (!current) {
      current = { heading: fallbackTitle, level: 2, paragraphs: [text] };
      sections.push(current);
    } else {
      (current.paragraphs ??= []).push(text);
    }
  };

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      // Not a valid table — treat each line as a paragraph.
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
    // tableBuffer[1] is the separator --- row; skip it.
    const rows = tableBuffer.slice(2).map(parseRow);
    tableBuffer = [];
    if (!current) {
      current = { heading: fallbackTitle, level: 2, table: { headers, rows } };
      sections.push(current);
    } else if (!current.table) {
      current.table = { headers, rows };
    } else {
      // Already has a table — open a fresh subsection.
      const nextLevel = Math.min(4, current.level + 1) as 2 | 3 | 4;
      const sub: DocumentSection = {
        heading: '',
        level: nextLevel,
        table: { headers, rows },
      };
      (current.children ??= []).push(sub);
    }
  };

  const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
  const isTableSeparator = (line: string) =>
    /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Table collection (contiguous pipe rows)
    if (isTableLine(line) || (tableBuffer.length === 1 && isTableSeparator(line))) {
      flushParagraph();
      tableBuffer.push(line);
      continue;
    } else if (tableBuffer.length > 0) {
      flushTable();
    }

    // Blank line — paragraph break.
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    // ATX heading.
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(4, headingMatch[1].length) as 1 | 2 | 3 | 4;
      const text = headingMatch[2].trim();
      if (level === 1 && sections.length === 0 && !current) {
        title = text || fallbackTitle;
        continue;
      }
      current = { heading: text, level: (level === 1 ? 2 : level) as 2 | 3 | 4 };
      sections.push(current);
      continue;
    }

    // Bullet list item.
    const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      flushParagraph();
      const text = stripInline(bulletMatch[1]);
      if (!current) {
        current = { heading: fallbackTitle, level: 2, bulletPoints: [text] };
        sections.push(current);
      } else {
        (current.bulletPoints ??= []).push(text);
      }
      continue;
    }

    // Numbered list item.
    const numberedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numberedMatch) {
      flushParagraph();
      const text = stripInline(numberedMatch[1]);
      if (!current) {
        current = { heading: fallbackTitle, level: 2, numberedItems: [text] };
        sections.push(current);
      } else {
        (current.numberedItems ??= []).push(text);
      }
      continue;
    }

    // Regular prose.
    paragraphBuffer.push(stripInline(line.trim()));
  }

  // Drain trailing buffers.
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

/** Strip a minimal set of inline markdown syntax so DOCX/PDF text is clean. */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
}

/**
 * Convert an artifact (title + markdown) to the requested format and trigger a
 * browser download. Uses the shared builders in `lib/export/document/*` so the
 * DOCX/PDF output matches the style of other exports in the app.
 */
export async function exportArtifact(
  args: { title: string; markdown: string; locale: Locale },
  format: ExportFormat,
): Promise<void> {
  const { title, markdown, locale } = args;
  const filename = slugifyTitle(title);
  let blob: Blob;
  let ext: string;

  if (format === 'markdown') {
    blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    ext = 'md';
  } else if (format === 'docx') {
    const doc = markdownToExportableDocument(markdown, locale, title);
    const { buildDocx } = await import('@/lib/export/document/docx-builder');
    blob = await buildDocx(doc);
    ext = 'docx';
  } else {
    const doc = markdownToExportableDocument(markdown, locale, title);
    const { buildPdf } = await import('@/lib/export/document/pdf-builder');
    blob = buildPdf(doc);
    ext = 'pdf';
  }

  const { saveAs } = await import('file-saver');
  saveAs(blob, `${filename}.${ext}`);
}
