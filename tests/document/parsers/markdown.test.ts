import { describe, expect, it } from 'vitest';
import { parseMarkdownDocument } from '@/lib/document/parsers/markdown';

describe('Markdown Parser', () => {
  it('returns markdown text and empty image metadata', async () => {
    const content = '# Heading\n\nSome markdown content.';
    const result = await parseMarkdownDocument(Buffer.from(content, 'utf-8'));

    expect(result.text).toBe(content);
    expect(result.images).toEqual([]);
    expect(result.metadata?.parser).toBe('markdown');
    expect(result.metadata?.pageCount).toBe(1);
    expect(result.metadata?.imageMapping).toEqual({});
    expect(result.metadata?.pdfImages).toEqual([]);
  });
});
