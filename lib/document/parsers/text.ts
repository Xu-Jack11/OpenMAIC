import type { ParsedDocumentContent } from '../types';

export async function parseTextDocument(
  fileBuffer: Buffer
): Promise<ParsedDocumentContent> {
  return {
    text: fileBuffer.toString('utf-8'),
    images: [],
    metadata: {
      pageCount: 1,
      parser: 'text',
      imageMapping: {},
      pdfImages: [],
    },
  };
}