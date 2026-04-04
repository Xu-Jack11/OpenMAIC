/**
 * Shared document export types
 *
 * ExportableDocument is a format-agnostic intermediate representation.
 * Each feature (handout, experiment, reading) produces an ExportableDocument,
 * and the shared builders convert it to Markdown, DOCX, or PDF.
 */

export type ExportFormat = 'pdf' | 'docx' | 'markdown';

export interface DocumentMeta {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  language: 'zh-CN' | 'en-US';
}

export interface DocumentSection {
  heading: string;
  level: 1 | 2 | 3 | 4;
  paragraphs?: string[];
  bulletPoints?: string[];
  numberedItems?: string[];
  table?: { headers: string[]; rows: string[][] };
  children?: DocumentSection[];
}

export interface ExportableDocument {
  meta: DocumentMeta;
  sections: DocumentSection[];
}
