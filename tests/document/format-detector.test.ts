import { describe, it, expect } from 'vitest';
import { detectFormat } from '@/lib/document/format-detector';

describe('format-detector', () => {
  it('detects PDF by mime type', () => {
    const file = new File([''], 'test.pdf', { type: 'application/pdf' });
    expect(detectFormat(file)).toBe('pdf');
  });

  it('detects DOCX by mime type', () => {
    const file = new File([''], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(detectFormat(file)).toBe('docx');
  });

  it('detects Markdown by extension fallback if mime is missing', () => {
    const file = new File([''], 'test.md', { type: '' });
    expect(detectFormat(file)).toBe('markdown');
  });

  it('detects images', () => {
    const file = new File([''], 'test.png', { type: 'image/png' });
    expect(detectFormat(file)).toBe('image');
  });

  it('returns null for unknown format', () => {
    const file = new File([''], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(detectFormat(file)).toBeNull();
  });
});
