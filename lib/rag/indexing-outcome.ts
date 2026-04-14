/**
 * Pure decision logic for mapping RAGFlow's terminal parsing status to the
 * local `Document.indexStatus`. Extracted from `indexer.ts` so it can be
 * unit-tested without pulling Prisma / filesystem into the test surface.
 */

import type { RagflowDocStatus } from './ragflow-client';
import type { IndexStatus } from './types';

/**
 * Accept `run=FAIL` as success when RAGFlow already produced enough chunks.
 * Motivated by the naive-parser control-code bug (memory/ragflow_parser_bug.md)
 * where embedding fails late but most chunks are usable.
 */
export const PARTIAL_SUCCESS_MIN_PROGRESS = (() => {
  const parsed = Number.parseFloat(process.env.RAGFLOW_PARTIAL_SUCCESS_MIN_PROGRESS || '');
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.7;
})();

export type TerminalIndexStatus = Extract<IndexStatus, 'indexed' | 'failed'>;

export interface IndexingOutcome {
  indexStatus: TerminalIndexStatus;
  /** Null on full success; `"partial: ..."` on partial; RAGFlow message on failure. */
  indexError: string | null;
  chunksCreated: number;
}

/**
 * True when the document was accepted as indexed despite RAGFlow reporting
 * failure (i.e., the partial-success path).
 */
export function isPartialSuccess(outcome: IndexingOutcome): boolean {
  return outcome.indexStatus === 'indexed' && outcome.indexError !== null;
}

/**
 * Decide the local indexing outcome from RAGFlow's terminal status.
 * Treats `run=FAIL` as success when `chunkCount > 0` and `progress >= threshold`.
 */
export function evaluateIndexingOutcome(
  status: RagflowDocStatus,
  threshold: number = PARTIAL_SUCCESS_MIN_PROGRESS,
): IndexingOutcome {
  if (status.run === 'DONE') {
    return { indexStatus: 'indexed', indexError: null, chunksCreated: status.chunkCount };
  }

  const passesThreshold =
    status.run === 'FAIL' && status.chunkCount > 0 && status.progress >= threshold;
  if (passesThreshold) {
    const note = `partial: ${status.chunkCount} chunks at ${(status.progress * 100).toFixed(1)}%${
      status.progressMsg ? ` — ${status.progressMsg}` : ''
    }`;
    return { indexStatus: 'indexed', indexError: note, chunksCreated: status.chunkCount };
  }

  const errorMsg =
    status.progressMsg || `RAGFlow parsing failed (run=${status.run}, chunks=${status.chunkCount})`;
  return { indexStatus: 'failed', indexError: errorMsg, chunksCreated: status.chunkCount };
}
