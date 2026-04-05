import { DocumentParserConfig, ParsedDocumentContent } from './types';
import { detectFormat } from './format-detector';
import { parsePdfDocument } from './parsers/pdf';
import { parseDocxDocument } from './parsers/docx';
import { parsePptxDocument } from './parsers/pptx';
import { parseMarkdownDocument } from './parsers/markdown';
import { parseTextDocument } from './parsers/text';
import { parseImageDocument } from './parsers/image';

function inferImageMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

export async function parseDocument(
  config: DocumentParserConfig,
  file: File
): Promise<ParsedDocumentContent> {
  const format = config.format || detectFormat(file);
  
  if (!format) {
    throw new Error(`Unsupported document format for file: ${file.name}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  switch (format) {
    case 'pdf':
      return parsePdfDocument(config, buffer);
    case 'docx':
      return parseDocxDocument(buffer);
    case 'pptx':
      return parsePptxDocument(buffer);
    case 'markdown':
      return parseMarkdownDocument(buffer);
    case 'text':
      return parseTextDocument(buffer);
    case 'image':
      return parseImageDocument(buffer, file.type || inferImageMimeType(file.name));
    default:
      throw new Error(`Parser not implemented for format: ${format}`);
  }
}