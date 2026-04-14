/**
 * RAGFlow HTTP Client
 *
 * Wraps RAGFlow REST API (http://{host}:9380/api/v1) for document
 * indexing, parsing, and retrieval operations.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('RAGFlow:Client');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RagflowDatasetConfig {
  chunkMethod?: string;
  embeddingModel?: string;
}

export interface RagflowDocStatus {
  id: string;
  name: string;
  run: 'UNSTART' | 'RUNNING' | 'CANCEL' | 'DONE' | 'FAIL';
  /** Number of chunks successfully produced so far. */
  chunkCount: number;
  /** Overall parsing progress, 0-1. */
  progress: number;
  /** Human-readable progress/failure message from RAGFlow. */
  progressMsg?: string;
}

export interface RagflowRetrievalParams {
  datasetIds: string[];
  question: string;
  topK?: number;
  similarityThreshold?: number;
  vectorSimilarityWeight?: number;
  documentIds?: string[];
  keyword?: boolean;
  highlight?: boolean;
}

export interface RagflowChunk {
  id: string;
  content: string;
  documentId: string;
  documentName: string;
  similarity: number;
  positions?: number[][];
  imageId?: string;
  importantKeywords?: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    baseUrl: (process.env.RAGFLOW_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.RAGFLOW_API_KEY || '',
  };
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RagflowApiResponse<T = unknown> {
  code: number;
  message?: string;
  data?: T;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: { formData?: FormData; timeout?: number },
): Promise<T> {
  const { baseUrl, apiKey } = getConfig();

  if (!baseUrl) {
    throw new Error('RAGFLOW_BASE_URL is not configured');
  }

  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  let fetchBody: BodyInit | undefined;

  if (options?.formData) {
    fetchBody = options.formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: AbortSignal.timeout(options?.timeout ?? 30_000),
      });

      const elapsed = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const brief = errorText.length > 300 ? `${errorText.slice(0, 300)}...` : errorText;
        const msg = `RAGFlow API ${method} ${path}: ${response.status} ${brief}`;

        if (attempt <= MAX_RETRIES && RETRY_STATUSES.has(response.status)) {
          const delay = RETRY_BASE_DELAY_MS * attempt;
          log.warn(`${msg} — retrying (${attempt}/${MAX_RETRIES}) after ${delay}ms`);
          await sleep(delay);
          continue;
        }

        throw new Error(msg);
      }

      const json = (await response.json()) as RagflowApiResponse<T>;
      log.debug(`${method} ${path} — ${response.status} ${elapsed}ms`);

      if (json.code !== 0) {
        throw new Error(`RAGFlow API error: ${json.message || `code ${json.code}`}`);
      }

      return json.data as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        lastError = new Error(`RAGFlow API ${method} ${path}: request timeout`);
      } else if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error(String(error));
      }

      const isNetwork = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(lastError.message);
      if (attempt <= MAX_RETRIES && isNetwork) {
        const delay = RETRY_BASE_DELAY_MS * attempt;
        log.warn(`${lastError.message} — retrying (${attempt}/${MAX_RETRIES}) after ${delay}ms`);
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  throw lastError!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if RAGFlow is configured (base URL and API key are set)
 */
export function isConfigured(): boolean {
  const { baseUrl, apiKey } = getConfig();
  return baseUrl.length > 0 && apiKey.length > 0;
}

/**
 * Health check — verify RAGFlow is reachable
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await request('GET', '/datasets?page=1&page_size=1');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dataset operations
// ---------------------------------------------------------------------------

/**
 * Create a new RAGFlow dataset (knowledge base) for a course.
 *
 * Defaults disable GraphRAG, RAPTOR, auto-keywords, auto-questions.
 * These features trigger expensive LLM calls per chunk (seconds each) and
 * would make indexing a 100-page document take hours. The OpenMAIC classroom
 * generation pipeline does its own requirement analysis, so these extras
 * provide little marginal benefit relative to their cost.
 */
export async function createDataset(name: string, config?: RagflowDatasetConfig): Promise<string> {
  const chunkMethod = config?.chunkMethod || process.env.RAGFLOW_CHUNK_METHOD || 'naive';

  const body: Record<string, unknown> = {
    name,
    permission: 'me',
    chunk_method: chunkMethod,
    parser_config: {
      chunk_token_num: 1024,
      layout_recognize: 'Plain Text',
      auto_keywords: 0,
      auto_questions: 0,
      graphrag: { use_graphrag: false },
      raptor: { use_raptor: false },
    },
  };

  if (config?.embeddingModel) {
    body.embedding_model = config.embeddingModel;
  }

  const data = await request<{ id: string }>('POST', '/datasets', body);
  log.info(`Created dataset "${name}": ${data.id}`);
  return data.id;
}

/**
 * Delete a RAGFlow dataset
 */
export async function deleteDataset(datasetId: string): Promise<void> {
  await request('DELETE', '/datasets', { ids: [datasetId] });
  log.info(`Deleted dataset: ${datasetId}`);
}

// ---------------------------------------------------------------------------
// Document operations
// ---------------------------------------------------------------------------

/**
 * Upload a document to a RAGFlow dataset
 */
export async function uploadDocument(
  datasetId: string,
  file: Buffer,
  filename: string,
): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(file)]);
  formData.append('file', blob, filename);

  const data = await request<Array<{ id: string }>>(
    'POST',
    `/datasets/${datasetId}/documents`,
    undefined,
    { formData, timeout: 120_000 },
  );

  const docId = Array.isArray(data) ? data[0]?.id : (data as unknown as { id: string })?.id;
  if (!docId) {
    throw new Error('RAGFlow upload returned no document ID');
  }

  log.info(`Uploaded document "${filename}" to dataset ${datasetId}: ${docId}`);
  return docId;
}

/**
 * Delete documents from a RAGFlow dataset
 */
export async function deleteDocument(datasetId: string, documentIds: string[]): Promise<void> {
  await request('DELETE', `/datasets/${datasetId}/documents`, { ids: documentIds });
  log.info(`Deleted ${documentIds.length} document(s) from dataset ${datasetId}`);
}

/**
 * Get the parsing status of a document in RAGFlow
 */
export async function getDocumentStatus(
  datasetId: string,
  documentId: string,
): Promise<RagflowDocStatus> {
  const data = await request<{ docs: RagflowDocStatusRaw[]; total: number }>(
    'GET',
    `/datasets/${datasetId}/documents?id=${documentId}`,
  );

  const docs = data?.docs || [];
  if (docs.length === 0) {
    throw new Error(`Document ${documentId} not found in dataset ${datasetId}`);
  }

  return mapRawDocStatus(docs[0]);
}

// ---------------------------------------------------------------------------
// Parsing operations
// ---------------------------------------------------------------------------

/**
 * Trigger parsing (chunking + embedding) for documents
 */
export async function startParsing(datasetId: string, documentIds: string[]): Promise<void> {
  await request('POST', `/datasets/${datasetId}/chunks`, {
    document_ids: documentIds,
  });
  log.info(`Started parsing ${documentIds.length} document(s) in dataset ${datasetId}`);
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve relevant chunks from RAGFlow using hybrid search
 */
export async function retrieve(params: RagflowRetrievalParams): Promise<RagflowChunk[]> {
  const body: Record<string, unknown> = {
    question: params.question,
    dataset_ids: params.datasetIds,
  };

  if (params.topK !== undefined) body.top_k = params.topK;
  if (params.similarityThreshold !== undefined)
    body.similarity_threshold = params.similarityThreshold;
  if (params.documentIds?.length) body.document_ids = params.documentIds;
  if (params.keyword !== undefined) body.keyword = params.keyword;
  if (params.highlight !== undefined) body.highlight = params.highlight;

  // Apply env-based vector similarity weight
  const vectorWeight =
    params.vectorSimilarityWeight ??
    (process.env.RAGFLOW_VECTOR_SIMILARITY_WEIGHT
      ? parseFloat(process.env.RAGFLOW_VECTOR_SIMILARITY_WEIGHT)
      : undefined);
  if (vectorWeight !== undefined) body.vector_similarity_weight = vectorWeight;

  const data = await request<{ chunks: RagflowRetrievalChunkRaw[]; total: number }>(
    'POST',
    '/retrieval',
    body,
  );

  const chunks = (data?.chunks || []).map(mapRawChunk);
  log.info(`Retrieved ${chunks.length} chunks for query (${params.question.slice(0, 60)}...)`);
  return chunks;
}

// ---------------------------------------------------------------------------
// Internal mapping
// ---------------------------------------------------------------------------

interface RagflowRetrievalChunkRaw {
  id: string;
  content: string;
  document_id: string;
  document_keyword?: string;
  similarity: number;
  positions?: number[][];
  image_id?: string;
  important_keywords?: string[];
}

function mapRawChunk(raw: RagflowRetrievalChunkRaw): RagflowChunk {
  return {
    id: raw.id,
    content: raw.content,
    documentId: raw.document_id,
    documentName: raw.document_keyword || '',
    similarity: raw.similarity,
    positions: raw.positions,
    imageId: raw.image_id,
    importantKeywords: raw.important_keywords,
  };
}

type RagflowDocStatusRaw = Omit<RagflowDocStatus, 'chunkCount' | 'progress' | 'progressMsg'> & {
  chunk_count?: number;
  progress?: number;
  progress_msg?: string;
};

function mapRawDocStatus(raw: RagflowDocStatusRaw): RagflowDocStatus {
  return {
    id: raw.id,
    name: raw.name,
    run: raw.run,
    chunkCount: typeof raw.chunk_count === 'number' ? raw.chunk_count : 0,
    progress: typeof raw.progress === 'number' ? raw.progress : 0,
    progressMsg: raw.progress_msg,
  };
}
