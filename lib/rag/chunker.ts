/**
 * Document Chunker
 *
 * Splits documents into semantic chunks suitable for embedding and retrieval.
 * Uses paragraph/heading boundaries to maintain context coherence.
 */

import type { DocumentChunkData, ChunkingConfig, ChunkMetadata } from './types';

// Default chunking parameters
const DEFAULT_CHUNK_SIZE = 512; // tokens (approx 4 chars per token)
const DEFAULT_CHUNK_OVERLAP = 50;
const DEFAULT_MIN_CHUNK_SIZE = 100;

// Approximate chars per token for rough estimation
const CHARS_PER_TOKEN = 4;

/**
 * Chunk a document's text content into semantic segments
 */
export function chunkDocument(
  text: string,
  documentName: string,
  documentType: string,
  config?: ChunkingConfig,
): DocumentChunkData[] {
  const chunkSize = (config?.chunkSize ?? DEFAULT_CHUNK_SIZE) * CHARS_PER_TOKEN;
  const chunkOverlap = (config?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP) * CHARS_PER_TOKEN;
  const minChunkSize = (config?.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE) * CHARS_PER_TOKEN;

  // First, split into paragraphs/sections
  const segments = splitIntoSegments(text);

  // Then, merge/split segments to fit target chunk size
  const chunks = createChunks(segments, chunkSize, chunkOverlap, minChunkSize);

  // Add metadata to each chunk
  return chunks.map((chunk, index) => ({
    content: chunk.content,
    chunkIndex: index,
    metadata: {
      documentName,
      documentType,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
    } as ChunkMetadata,
  }));
}

interface TextSegment {
  content: string;
  startChar: number;
  endChar: number;
  pageNumber?: number;
  sectionTitle?: string;
  isHeading?: boolean;
}

/**
 * Split text into natural segments (paragraphs, headings)
 */
function splitIntoSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];

  // Detect page breaks (common in PDF extractions)
  const pages = text.split(/\n{3,}|\f/);

  let charOffset = 0;
  let currentPage = 1;
  let currentSection: string | undefined;

  for (const page of pages) {
    // Split page into paragraphs
    const paragraphs = page.split(/\n\n+/);

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        charOffset += para.length + 2; // account for \n\n
        continue;
      }

      // Detect headings (lines that are short, possibly all caps or with markers)
      const isHeading = detectHeading(trimmed);

      if (isHeading) {
        currentSection = trimmed;
      }

      segments.push({
        content: trimmed,
        startChar: charOffset,
        endChar: charOffset + trimmed.length,
        pageNumber: currentPage,
        sectionTitle: currentSection,
        isHeading,
      });

      charOffset += para.length + 2;
    }

    currentPage++;
  }

  return segments;
}

/**
 * Detect if a line is likely a heading
 */
function detectHeading(text: string): boolean {
  // Short lines that look like headings
  if (text.length < 100) {
    // Markdown headings
    if (/^#{1,6}\s/.test(text)) return true;
    // Numbered headings (1. 2.1 etc)
    if (/^\d+(\.\d+)*\.?\s+\S/.test(text) && text.length < 80) return true;
    // All caps short lines
    if (text === text.toUpperCase() && text.length > 3 && text.length < 60) return true;
    // Lines ending with colon (often section headers)
    if (text.endsWith(':') && text.length < 60) return true;
  }
  return false;
}

interface ChunkResult {
  content: string;
  startChar: number;
  endChar: number;
  pageNumber?: number;
  sectionTitle?: string;
}

/**
 * Create chunks from segments, respecting size limits and overlap
 */
function createChunks(
  segments: TextSegment[],
  targetSize: number,
  overlap: number,
  minSize: number,
): ChunkResult[] {
  const chunks: ChunkResult[] = [];

  let currentChunk: string[] = [];
  let currentSize = 0;
  let chunkStartChar = 0;
  let chunkEndChar = 0;
  let chunkPage: number | undefined;
  let chunkSection: string | undefined;

  for (const segment of segments) {
    const segmentSize = segment.content.length;

    // If segment alone exceeds target, split it
    if (segmentSize > targetSize) {
      // Flush current chunk first
      if (currentChunk.length > 0 && currentSize >= minSize) {
        chunks.push({
          content: currentChunk.join('\n\n'),
          startChar: chunkStartChar,
          endChar: chunkEndChar,
          pageNumber: chunkPage,
          sectionTitle: chunkSection,
        });
        currentChunk = [];
        currentSize = 0;
      }

      // Split large segment into sentence-based chunks
      const subChunks = splitLargeSegment(segment, targetSize, overlap);
      chunks.push(...subChunks);
      continue;
    }

    // If adding this segment would exceed target, flush and start new chunk
    if (currentSize + segmentSize > targetSize && currentSize >= minSize) {
      chunks.push({
        content: currentChunk.join('\n\n'),
        startChar: chunkStartChar,
        endChar: chunkEndChar,
        pageNumber: chunkPage,
        sectionTitle: chunkSection,
      });

      // Start new chunk with overlap from previous
      const overlapText = getOverlapText(currentChunk.join('\n\n'), overlap);
      currentChunk = overlapText ? [overlapText] : [];
      currentSize = overlapText?.length ?? 0;
      chunkStartChar = chunkEndChar - (overlapText?.length ?? 0);
    }

    // Add segment to current chunk
    if (currentChunk.length === 0) {
      chunkStartChar = segment.startChar;
      chunkPage = segment.pageNumber;
      chunkSection = segment.sectionTitle;
    }

    currentChunk.push(segment.content);
    currentSize += segmentSize + 2; // +2 for join separator
    chunkEndChar = segment.endChar;

    // Update section if this segment has one
    if (segment.sectionTitle) {
      chunkSection = segment.sectionTitle;
    }
  }

  // Flush remaining chunk
  if (currentChunk.length > 0 && currentSize >= minSize) {
    chunks.push({
      content: currentChunk.join('\n\n'),
      startChar: chunkStartChar,
      endChar: chunkEndChar,
      pageNumber: chunkPage,
      sectionTitle: chunkSection,
    });
  } else if (currentChunk.length > 0 && chunks.length > 0) {
    // Merge small trailing chunk with previous
    const lastChunk = chunks[chunks.length - 1];
    lastChunk.content += '\n\n' + currentChunk.join('\n\n');
    lastChunk.endChar = chunkEndChar;
  } else if (currentChunk.length > 0) {
    // First and only chunk, even if small
    chunks.push({
      content: currentChunk.join('\n\n'),
      startChar: chunkStartChar,
      endChar: chunkEndChar,
      pageNumber: chunkPage,
      sectionTitle: chunkSection,
    });
  }

  return chunks;
}

/**
 * Split a large segment into smaller chunks by sentences
 */
function splitLargeSegment(
  segment: TextSegment,
  targetSize: number,
  overlap: number,
): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const text = segment.content;

  // Split by sentences
  const sentences = text.split(/(?<=[.!?。！？])\s+/);

  let currentChunk: string[] = [];
  let currentSize = 0;
  let startOffset = 0;

  for (const sentence of sentences) {
    if (currentSize + sentence.length > targetSize && currentChunk.length > 0) {
      const content = currentChunk.join(' ');
      chunks.push({
        content,
        startChar: segment.startChar + startOffset,
        endChar: segment.startChar + startOffset + content.length,
        pageNumber: segment.pageNumber,
        sectionTitle: segment.sectionTitle,
      });

      // Start new chunk with overlap
      const overlapText = getOverlapText(content, overlap);
      currentChunk = overlapText ? [overlapText] : [];
      currentSize = overlapText?.length ?? 0;
      startOffset += content.length - (overlapText?.length ?? 0);
    }

    currentChunk.push(sentence);
    currentSize += sentence.length + 1;
  }

  // Flush remaining
  if (currentChunk.length > 0) {
    const content = currentChunk.join(' ');
    chunks.push({
      content,
      startChar: segment.startChar + startOffset,
      endChar: segment.endChar,
      pageNumber: segment.pageNumber,
      sectionTitle: segment.sectionTitle,
    });
  }

  return chunks;
}

/**
 * Get overlap text from the end of a chunk
 */
function getOverlapText(text: string, overlapChars: number): string | null {
  if (text.length <= overlapChars) {
    return null;
  }

  // Try to break at word boundary
  const overlapStart = text.length - overlapChars;
  const spaceIndex = text.indexOf(' ', overlapStart);

  if (spaceIndex > overlapStart && spaceIndex < text.length - 10) {
    return text.slice(spaceIndex + 1);
  }

  return text.slice(overlapStart);
}

/**
 * Estimate token count for a text (rough approximation)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
