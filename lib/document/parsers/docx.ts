/* eslint-disable @typescript-eslint/no-explicit-any */
import mammoth from 'mammoth';
import type { ParsedDocumentContent } from '../types';
import { createLogger } from '@/lib/logger';

const log = createLogger('DOCXParser');

export async function parseDocxDocument(
  fileBuffer: Buffer
): Promise<ParsedDocumentContent> {
  const images: string[] = [];
  const pdfImages: NonNullable<ParsedDocumentContent['metadata']>['pdfImages'] = [];
  const imageMapping: Record<string, string> = {};
  let imageCounter = 0;

  const options: any = {
    convertImage: (mammoth as any).images.inline((element: any) => {
      return element.read("base64").then((imageBuffer: any) => {
        const mime = element.contentType;
        const base64 = `data:${mime};base64,${imageBuffer}`;
        
        imageCounter++;
        const id = `img_${imageCounter}`;
        
        images.push(base64);
        imageMapping[id] = base64;
        pdfImages.push({
          id,
          src: base64,
          pageNumber: 1, // All images in DOCX are mapped to page 1
        });
        
        return { src: base64 };
      });
    }),
  };

  try {
    // We convert to markdown for consistency with PDF parsing
    const result = await (mammoth as any).convertToMarkdown({ buffer: fileBuffer }, options);
    
    if (result.messages && result.messages.length > 0) {
      log.warn('Mammoth warnings during DOCX parsing:', result.messages);
    }

    return {
      text: result.value,
      images,
      metadata: {
        pageCount: 1,
        parser: 'mammoth',
        imageMapping,
        pdfImages,
      },
    };
  } catch (error) {
    log.error('Failed to parse DOCX:', error);
    throw error;
  }
}