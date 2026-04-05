import { parse as parsePptx } from 'pptxtojson';
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParsedDocumentContent } from '../types';
import { createLogger } from '@/lib/logger';

const log = createLogger('PPTXParser');

export async function parsePptxDocument(
  fileBuffer: Buffer
): Promise<ParsedDocumentContent> {
  try {
    // pptxtojson expects ArrayBuffer
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer;
    const json = await parsePptx(arrayBuffer);
    
    let text = '';
    const images: string[] = [];
    const pdfImages: NonNullable<ParsedDocumentContent['metadata']>['pdfImages'] = [];
    const imageMapping: Record<string, string> = {};
    let imageCounter = 0;

    const slides = json.slides || [];
    
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideNumber = i + 1;
      
      text += `## Slide ${slideNumber}\n\n`;
      
      const elements = slide.elements || [];
      for (const el of elements) {
        // Cast to any for flexible property access — runtime data may
        // include properties beyond the strict TS declarations
        const elAny = el as any;
        if (el.type === 'text') {
          // PPTXToJson returns text content as `content` (string or array)
          const rawText = elAny.content || '';
          if (typeof rawText === 'string') {
             text += `${rawText}\n`;
          } else if (Array.isArray(rawText)) {
             text += rawText.map((t: any) => t?.text || '').join(' ') + '\n';
          }
        } else if (el.type === 'image') {
          const imgSrc: string | undefined = elAny.src || elAny.data;
          if (imgSrc) {
            // Ensure it's a data URL
            const dataUrl = imgSrc.startsWith('data:') ? imgSrc : `data:image/png;base64,${imgSrc}`;
            
            imageCounter++;
            const id = `img_${imageCounter}`;
            
            images.push(dataUrl);
            imageMapping[id] = dataUrl;
            pdfImages.push({
              id,
              src: dataUrl,
              pageNumber: slideNumber,
              width: el.width,
              height: el.height,
            });
          }
        }
      }
      text += '\n';
    }

    return {
      text: text.trim(),
      images,
      metadata: {
        pageCount: slides.length,
        parser: 'pptxtojson',
        imageMapping,
        pdfImages,
      },
    };
  } catch (error) {
    log.error('Failed to parse PPTX:', error);
    throw error;
  }
}