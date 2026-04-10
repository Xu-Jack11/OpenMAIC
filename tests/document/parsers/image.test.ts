import { describe, it, expect } from 'vitest';
import { parseImageDocument } from '@/lib/document/parsers/image';

describe('Image Parser', () => {
  it('parses a basic image to a ParsedDocumentContent', async () => {
    // 1x1 transparent PNG buffer
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    const result = await parseImageDocument(pngBuffer, 'image/png');

    expect(result.text).toBe('');
    expect(result.images.length).toBe(1);
    expect(result.images[0]).toContain('data:image/png;base64');
    expect(result.metadata?.pdfImages?.length).toBe(1);
    expect(result.metadata?.pdfImages?.[0].width).toBe(1);
    expect(result.metadata?.pdfImages?.[0].height).toBe(1);
    expect(result.metadata?.pdfImages?.[0].pageNumber).toBe(1);
  });
});
