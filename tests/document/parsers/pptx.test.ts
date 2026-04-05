import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseMock = vi.fn();

vi.mock('pptxtojson', () => ({
  parse: parseMock,
}));

describe('PPTX Parser', () => {
  beforeEach(() => {
    parseMock.mockReset();
  });

  it('extracts per-slide text and image metadata', async () => {
    parseMock.mockResolvedValue({
      slides: [
        {
          elements: [
            { type: 'text', content: 'Slide One' },
            { type: 'image', src: 'data:image/png;base64,abc', width: 100, height: 80 },
          ],
        },
        {
          elements: [{ type: 'text', content: 'Slide Two' }],
        },
      ],
    });

    const { parsePptxDocument } = await import('@/lib/document/parsers/pptx');
    const result = await parsePptxDocument(Buffer.from('fake-pptx'));

    expect(result.text).toContain('## Slide 1');
    expect(result.text).toContain('Slide One');
    expect(result.text).toContain('## Slide 2');
    expect(result.metadata?.pageCount).toBe(2);
    expect(result.metadata?.parser).toBe('pptxtojson');
    expect(result.metadata?.pdfImages?.[0].pageNumber).toBe(1);
    expect(result.metadata?.pdfImages?.[0].width).toBe(100);
  });
});
