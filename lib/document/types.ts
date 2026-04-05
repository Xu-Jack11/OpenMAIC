import { ParsedDocumentContent } from '../types/document';

export type DocumentFormatId = 'pdf' | 'docx' | 'pptx' | 'markdown' | 'text' | 'image';

export const DOCUMENT_FORMAT_IDS: DocumentFormatId[] = [
  'pdf',
  'docx',
  'pptx',
  'markdown',
  'text',
  'image',
];

export interface DocumentParserConfig {
  format?: DocumentFormatId;
  providerId?: string; // PDF only
  apiKey?: string; // PDF only
  baseUrl?: string; // PDF only
}

export type { ParsedDocumentContent };