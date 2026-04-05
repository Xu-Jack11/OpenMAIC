import { beforeEach, describe, expect, it, vi } from 'vitest';

const convertToMarkdownMock = vi.fn();

vi.mock('mammoth', () => ({
  default: {
    images: {
      inline: (_handler: unknown) => ({ mocked: true }),
    },
    convertToMarkdown: convertToMarkdownMock,
  },
}));

describe('DOCX Parser', () => {
  beforeEach(() => {
    convertToMarkdownMock.mockReset();
  });

  it('parses DOCX content to text and metadata', async () => {
    convertToMarkdownMock.mockResolvedValue({
      value: '# Title\n\nBody content',
      messages: [],
    });

    const { parseDocxDocument } = await import('@/lib/document/parsers/docx');
    const result = await parseDocxDocument(Buffer.from('fake-docx'));

    expect(result.text).toContain('Title');
    expect(result.metadata?.parser).toBe('mammoth');
    expect(result.metadata?.pageCount).toBe(1);
    expect(result.metadata?.pdfImages).toEqual([]);
    expect(result.metadata?.imageMapping).toEqual({});
  });
});
