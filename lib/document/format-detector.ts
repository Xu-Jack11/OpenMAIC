import { DocumentFormatId } from './types';
import { DOCUMENT_FORMATS } from './constants';

export function detectFormat(file: File): DocumentFormatId | null {
  const mimeType = file.type;

  // 1. Try to match by MIME type first
  for (const format of Object.values(DOCUMENT_FORMATS)) {
    if (format.mimeTypes.includes(mimeType)) {
      return format.id;
    }
  }

  // 2. Fallback to extension matching
  const filename = file.name.toLowerCase();
  for (const format of Object.values(DOCUMENT_FORMATS)) {
    if (format.extensions.some((ext) => filename.endsWith(ext))) {
      return format.id;
    }
  }

  return null;
}
