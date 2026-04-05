import { DocumentFormatId } from './types';

// PDF size is 50MB (from previous MAX_PDF_SIZE_MB)
export const MAX_FILE_SIZE_MB = 50;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const DOCUMENT_FORMATS: Record<DocumentFormatId, {
  id: DocumentFormatId;
  name: string;
  extensions: string[];
  mimeTypes: string[];
}> = {
  pdf: {
    id: 'pdf',
    name: 'PDF Document',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
  },
  docx: {
    id: 'docx',
    name: 'Word Document',
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  pptx: {
    id: 'pptx',
    name: 'PowerPoint Presentation',
    extensions: ['.pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  },
  markdown: {
    id: 'markdown',
    name: 'Markdown Document',
    extensions: ['.md', '.markdown'],
    mimeTypes: ['text/markdown'],
  },
  text: {
    id: 'text',
    name: 'Text Document',
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
  },
  image: {
    id: 'image',
    name: 'Image',
    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  }
};