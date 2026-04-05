import sharp from 'sharp';
import type { ParsedDocumentContent } from '../types';
import { createLogger } from '@/lib/logger';

const log = createLogger('ImageParser');

export async function parseImageDocument(
  fileBuffer: Buffer,
  mimeType: string
): Promise<ParsedDocumentContent> {
  try {
    const metadata = await sharp(fileBuffer).metadata();
    const base64 = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    
    const id = 'img_1';
    const images = [base64];
    const imageMapping = { [id]: base64 };
    const pdfImages = [
      {
        id,
        src: base64,
        pageNumber: 1,
        width: metadata.width,
        height: metadata.height,
      },
    ];

    return {
      text: '', // Empty text for image, LLM will rely entirely on the image mapping
      images,
      metadata: {
        pageCount: 1,
        parser: 'sharp',
        imageMapping,
        pdfImages,
      },
    };
  } catch (error) {
    log.error('Failed to parse Image:', error);
    throw error;
  }
}