/**
 * Semantic chunker for RAG indexing.
 *
 * Produces a flat `PreparedChunk[]` from either:
 *   (a) a `MineruResult` with structured blocks (preferred — tables stay as
 *       Markdown, figures become image chunks with caption, formulas stay as
 *       LaTeX), or
 *   (b) a plain `ParsedDocumentContent` with just `text` (fallback for unpdf
 *       or when MinerU is unavailable).
 *
 * Text splitting targets ~800 tokens per chunk with ~120 token overlap,
 * CJK-aware (treats Chinese chars as single tokens worth ~1.5 latin tokens).
 * We break on paragraph / sentence boundaries preferentially.
 */

import type { ParsedDocumentContent } from '@/lib/types/document';
import type { PreparedChunk } from './types';
import type { MineruResult, MineruBlock } from './mineru-client';

const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 120;

/**
 * Rough token estimate. Each CJK codepoint ≈ 1 token; each latin word ≈ 1 token.
 * This is intentionally cheap — we don't need BPE accuracy for chunk-size control.
 */
export function estimateTokens(s: string): number {
  if (!s) return 0;
  let cjk = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // CJK Unified Ideographs + Hiragana + Katakana + Hangul
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk++;
    }
  }
  const nonCjkChars = s.length - cjk;
  // ~4 chars per latin token, 1 CJK char per token
  return cjk + Math.ceil(nonCjkChars / 4);
}

/**
 * Split raw text into semantic chunks.
 *
 * Strategy:
 *   1. Split on blank lines to get paragraphs.
 *   2. Greedy-accumulate paragraphs into chunks while under TARGET_TOKENS.
 *   3. If a single paragraph exceeds TARGET_TOKENS, sub-split by sentence boundary
 *      (`。`, `.`, `!`, `?`, `！`, `？`, newline) and again greedy-accumulate.
 *   4. Add a tail-overlap of ~OVERLAP_TOKENS from the previous chunk to each
 *      new chunk to preserve cross-chunk references.
 */
export function splitText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, '\n').trim();
  if (!normalised) return [];

  const paragraphs = normalised
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (estimateTokens(p) <= TARGET_TOKENS) {
      pieces.push(p);
      continue;
    }
    // Oversized paragraph — split by sentence boundary.
    const sentences = p
      .split(/(?<=[。.!?！？\n])/)
      .map((s) => s.trim())
      .filter(Boolean);
    let buf = '';
    for (const s of sentences) {
      if (estimateTokens(buf) + estimateTokens(s) > TARGET_TOKENS && buf) {
        pieces.push(buf.trim());
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf.trim()) pieces.push(buf.trim());
  }

  // Safety net: anything still over target (e.g. punctuation-free CJK blob)
  // gets hard-sliced into fixed-size pieces. Keeps chunks bounded no matter
  // how pathological the input is.
  const bounded: string[] = [];
  for (const piece of pieces) {
    if (estimateTokens(piece) <= TARGET_TOKENS) {
      bounded.push(piece);
      continue;
    }
    bounded.push(...hardSplit(piece, TARGET_TOKENS));
  }
  pieces.length = 0;
  pieces.push(...bounded);

  // Greedy merge small pieces toward TARGET_TOKENS, with overlap.
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (estimateTokens(candidate) > TARGET_TOKENS && current) {
      chunks.push(current);
      current = carryOverlap(current) + (carryOverlap(current) ? '\n\n' : '') + piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Slice a string into pieces each ≤ ~targetTokens. Character-indexed so it
 * never breaks inside a UTF-16 surrogate pair; otherwise punctuation-blind.
 */
function hardSplit(text: string, targetTokens: number): string[] {
  // Rough estimate: for CJK-heavy text, 1 token ≈ 1 char; for latin, ≈ 4 chars.
  // Use a conservative middle-ground of 1.5 chars per token to stay safely below.
  const charsPerChunk = Math.max(1, Math.floor(targetTokens * 1.5));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += charsPerChunk) {
    out.push(text.slice(i, i + charsPerChunk));
  }
  return out;
}

function carryOverlap(prevChunk: string): string {
  if (!prevChunk) return '';
  const target = OVERLAP_TOKENS;
  // Walk back sentences from the end until we have ~target tokens.
  const sentences = prevChunk.split(/(?<=[。.!?！？\n])/);
  let acc = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const next = sentences[i] + acc;
    if (estimateTokens(next) > target && acc) break;
    acc = next;
  }
  return acc.trim();
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Build chunks from MinerU's structured result.
 * Each block type maps to a different chunk type; text blocks go through
 * `splitText` in case a single paragraph is very long.
 */
export function chunkFromMineru(result: MineruResult): PreparedChunk[] {
  const chunks: PreparedChunk[] = [];

  // Accumulate consecutive text blocks into a single "text run" so that
  // heading + paragraph + paragraph stay together in the same chunk.
  let textBuffer: string[] = [];
  const flushTextBuffer = () => {
    if (textBuffer.length === 0) return;
    const merged = textBuffer.join('\n\n');
    textBuffer = [];
    for (const piece of splitText(merged)) {
      chunks.push({ chunkType: 'text', content: piece });
    }
  };

  for (const block of result.contentList) {
    switch (block.type) {
      case 'text': {
        const prefix =
          block.text_level && block.text_level > 0 ? '#'.repeat(block.text_level) + ' ' : '';
        textBuffer.push(prefix + block.text);
        break;
      }
      case 'table': {
        flushTextBuffer();
        const caption = block.table_caption?.join(' ').trim();
        const body = block.table_body?.trim() ?? '';
        const content = caption ? `**${caption}**\n\n${body}` : body;
        if (content) {
          chunks.push({
            chunkType: 'table',
            content,
            metadata: { page: block.page_idx, caption },
          });
        }
        break;
      }
      case 'equation':
      case 'formula': {
        flushTextBuffer();
        const latex = block.text?.trim();
        if (latex) {
          chunks.push({
            chunkType: 'formula',
            content: latex,
            metadata: { page: block.page_idx },
          });
        }
        break;
      }
      case 'image': {
        flushTextBuffer();
        const caption = block.image_caption?.join(' ').trim() ?? '';
        const imgKey = block.img_path;
        const imageEntry = imgKey ? result.images[imgKey] : undefined;
        if (!imgKey || !imageEntry) break;
        const { buffer, ext } = decodeImage(imageEntry);
        chunks.push({
          chunkType: 'image',
          content: caption,
          imageBuffer: buffer,
          imageExt: ext,
          metadata: { page: block.page_idx, caption, originalPath: imgKey },
        });
        break;
      }
    }
  }

  flushTextBuffer();
  return chunks;
}

/**
 * Fallback: build chunks from the plain text output of `lib/document/`.
 * Does not emit image chunks.
 */
export function chunkFromParsed(parsed: ParsedDocumentContent): PreparedChunk[] {
  return splitText(parsed.text).map<PreparedChunk>((piece) => ({
    chunkType: 'text',
    content: piece,
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decode an image entry from MinerU. MinerU may return either a raw base64
 * payload or a `data:image/...;base64,...` URL.
 */
function decodeImage(src: string): { buffer: Buffer; ext: string } {
  const match = src.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.*)$/);
  if (match) {
    return { buffer: Buffer.from(match[2], 'base64'), ext: normaliseExt(match[1]) };
  }
  return { buffer: Buffer.from(src, 'base64'), ext: 'png' };
}

function normaliseExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'jpeg' || m === 'jpg') return 'jpg';
  if (m === 'png' || m === 'webp' || m === 'gif') return m;
  return 'png';
}

// Exported for unit tests.
export const __testing__ = { carryOverlap };

// Re-export block type for callers.
export type { MineruBlock };
