import { parsePDF } from '@/lib/pdf/pdf-providers';
import type { PDFProviderId } from '@/lib/pdf/types';
import type { ParsedDocumentContent, DocumentParserConfig } from '../types';

export async function parsePdfDocument(
  config: DocumentParserConfig,
  fileBuffer: Buffer
): Promise<ParsedDocumentContent> {
  // If no providerId is specified, fallback to unpdf
  const pdfConfig = {
    providerId: (config.providerId as PDFProviderId) || 'unpdf',
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  };

  return parsePDF(pdfConfig, fileBuffer);
}