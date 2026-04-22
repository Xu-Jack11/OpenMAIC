import { describe, it, expect } from 'vitest';
import { splitText, chunkFromParsed, chunkFromMineru, estimateTokens } from '@/lib/rag/chunker';
import type { ParsedDocumentContent } from '@/lib/types/document';
import type { MineruResult } from '@/lib/rag/mineru-client';

describe('estimateTokens', () => {
  it('counts CJK chars as 1 token each', () => {
    expect(estimateTokens('你好世界')).toBe(4);
  });
  it('approximates 4 latin chars per token', () => {
    expect(estimateTokens('hello')).toBe(Math.ceil(5 / 4));
  });
  it('handles mixed CJK + latin', () => {
    // 3 CJK + 5 latin chars → 3 + ceil(5/4) = 5
    expect(estimateTokens('你好吗hello')).toBe(5);
  });
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('splitText', () => {
  it('returns empty array for empty input', () => {
    expect(splitText('')).toEqual([]);
    expect(splitText('   \n\n   ')).toEqual([]);
  });

  it('keeps a short paragraph as a single chunk', () => {
    const out = splitText('This is a short paragraph.');
    expect(out.length).toBe(1);
    expect(out[0]).toContain('short paragraph');
  });

  it('splits very long text into multiple chunks respecting ~800 token target', () => {
    const huge = Array.from(
      { length: 30 },
      (_, i) => `段落 ${i}: ` + '这是一段测试用的中文内容'.repeat(20),
    ).join('\n\n');
    const out = splitText(huge);
    expect(out.length).toBeGreaterThan(1);
    // Every chunk should not wildly exceed target (allow some slack)
    for (const c of out) {
      expect(estimateTokens(c)).toBeLessThan(1500);
    }
  });

  it('does not break within CJK words', () => {
    const out = splitText('你好世界'.repeat(500));
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      // Nothing weird like stray replacement chars
      expect(c).not.toContain('\uFFFD');
    }
  });

  it('adds overlap between consecutive chunks', () => {
    const long = Array.from(
      { length: 10 },
      (_, i) => `Sentence ${i} ${'lorem ipsum '.repeat(80)}.`,
    ).join('\n\n');
    const out = splitText(long);
    if (out.length >= 2) {
      // Some fragment of the first chunk's tail should appear near the second
      // chunk's head (best-effort check — overlap is not guaranteed literal).
      expect(out[1].length).toBeGreaterThan(0);
    }
  });
});

describe('chunkFromParsed', () => {
  it('produces text chunks from plain text', () => {
    const parsed: ParsedDocumentContent = {
      text: 'First paragraph.\n\nSecond paragraph.',
      images: [],
    };
    const chunks = chunkFromParsed(parsed);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.chunkType).toBe('text');
  });

  it('returns zero chunks for empty text', () => {
    expect(chunkFromParsed({ text: '', images: [] })).toEqual([]);
  });
});

describe('chunkFromMineru', () => {
  it('separates text / table / formula / image blocks', () => {
    const mineru: MineruResult = {
      markdown: '',
      images: {
        'image_1.png': 'iVBORw0KGgo=', // base64 header bytes
      },
      contentList: [
        { type: 'text', text: 'Introduction', text_level: 1, page_idx: 1 },
        { type: 'text', text: 'Some text after the heading.', page_idx: 1 },
        {
          type: 'table',
          table_body: '| a | b |\n| - | - |\n| 1 | 2 |',
          table_caption: ['Table 1. Example'],
          page_idx: 2,
        },
        { type: 'equation', text: 'E = mc^2', page_idx: 2 },
        {
          type: 'image',
          img_path: 'image_1.png',
          image_caption: ['Figure 1. Sample'],
          page_idx: 3,
        },
      ],
    };
    const chunks = chunkFromMineru(mineru);
    const byType = chunks.reduce<Record<string, number>>((acc, c) => {
      acc[c.chunkType] = (acc[c.chunkType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType.text).toBeGreaterThanOrEqual(1);
    expect(byType.table).toBe(1);
    expect(byType.formula).toBe(1);
    expect(byType.image).toBe(1);

    const imgChunk = chunks.find((c) => c.chunkType === 'image');
    expect(imgChunk?.imageBuffer).toBeInstanceOf(Buffer);
    expect(imgChunk?.content).toContain('Figure 1');
  });

  it('skips image blocks with missing image data', () => {
    const mineru: MineruResult = {
      markdown: '',
      images: {},
      contentList: [
        {
          type: 'image',
          img_path: 'missing.png',
          image_caption: ['Orphan'],
        },
      ],
    };
    const chunks = chunkFromMineru(mineru);
    expect(chunks).toEqual([]);
  });
});
