import { describe, expect, it } from 'vitest';

import { evaluateIndexingOutcome, isPartialSuccess } from '@/lib/rag/indexing-outcome';
import type { RagflowDocStatus } from '@/lib/rag/ragflow-client';

function status(overrides: Partial<RagflowDocStatus>): RagflowDocStatus {
  return {
    id: 'rf-1',
    name: 'doc.pdf',
    run: 'FAIL',
    chunkCount: 0,
    progress: 0,
    ...overrides,
  };
}

describe('evaluateIndexingOutcome', () => {
  it('marks run=DONE as fully indexed with no error', () => {
    const out = evaluateIndexingOutcome(status({ run: 'DONE', chunkCount: 42, progress: 1.0 }));
    expect(out).toEqual({ indexStatus: 'indexed', indexError: null, chunksCreated: 42 });
    expect(isPartialSuccess(out)).toBe(false);
  });

  it('marks run=FAIL with progress ≥ threshold and chunks>0 as indexed (partial)', () => {
    const out = evaluateIndexingOutcome(
      status({ run: 'FAIL', chunkCount: 50, progress: 0.8, progressMsg: 'embedding timeout' }),
      0.7,
    );
    expect(out).toEqual({
      indexStatus: 'indexed',
      indexError: 'partial: 50 chunks at 80.0% — embedding timeout',
      chunksCreated: 50,
    });
    expect(isPartialSuccess(out)).toBe(true);
  });

  it('omits the dash segment when RAGFlow provides no progressMsg on partial success', () => {
    const out = evaluateIndexingOutcome(status({ run: 'FAIL', chunkCount: 7, progress: 0.9 }), 0.7);
    expect(out.indexError).toBe('partial: 7 chunks at 90.0%');
  });

  it('marks run=FAIL below threshold as failed', () => {
    const out = evaluateIndexingOutcome(
      status({ run: 'FAIL', chunkCount: 50, progress: 0.5, progressMsg: 'kaput' }),
      0.7,
    );
    expect(out).toEqual({ indexStatus: 'failed', indexError: 'kaput', chunksCreated: 50 });
  });

  it('marks run=FAIL with zero chunks as failed regardless of progress', () => {
    const out = evaluateIndexingOutcome(
      status({ run: 'FAIL', chunkCount: 0, progress: 0.95 }),
      0.7,
    );
    expect(out.indexStatus).toBe('failed');
  });

  it('marks run=CANCEL as failed', () => {
    const out = evaluateIndexingOutcome(
      status({ run: 'CANCEL', chunkCount: 10, progress: 0.9 }),
      0.7,
    );
    expect(out.indexStatus).toBe('failed');
  });

  it('synthesizes an error message when RAGFlow provides no progressMsg', () => {
    const out = evaluateIndexingOutcome(status({ run: 'FAIL', chunkCount: 0, progress: 0 }), 0.7);
    expect(out.indexError).toBe('RAGFlow parsing failed (run=FAIL, chunks=0)');
  });

  it('respects caller-supplied threshold override', () => {
    // progress 0.8 would pass default 0.7, but caller requires 0.9
    const out = evaluateIndexingOutcome(
      status({ run: 'FAIL', chunkCount: 50, progress: 0.8 }),
      0.9,
    );
    expect(out.indexStatus).toBe('failed');
  });

  it('accepts edge case progress exactly at threshold', () => {
    const out = evaluateIndexingOutcome(status({ run: 'FAIL', chunkCount: 1, progress: 0.7 }), 0.7);
    expect(out.indexStatus).toBe('indexed');
    expect(isPartialSuccess(out)).toBe(true);
  });
});
