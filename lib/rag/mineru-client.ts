/**
 * MinerU REST API client.
 *
 * Calls a self-hosted MinerU FastAPI service (default port 8003). The user
 * deploys MinerU via `pip install "mineru[core,vllm]"` and starts it via
 * `mineru-api --host 0.0.0.0 --port 8003`, so backend=hybrid-auto-engine
 * is locally supported (VLM in-process).
 *
 * Docs: POST /file_parse accepts multipart/form-data with `files`, `backend`,
 * `return_md`, `return_content_list`, `return_images`, etc.
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG:MinerU');

/** Normalised block shape. */
export type MineruBlock =
  | {
      type: 'text';
      text: string;
      text_level?: number;
      page_idx?: number;
    }
  | {
      type: 'image';
      img_path: string;
      image_caption?: string[];
      page_idx?: number;
    }
  | {
      type: 'table';
      table_body?: string;
      table_caption?: string[];
      page_idx?: number;
    }
  | {
      type: 'equation' | 'formula';
      text: string;
      page_idx?: number;
    };

export interface MineruResult {
  markdown: string;
  contentList: MineruBlock[];
  /** key → base64 or data URL */
  images: Record<string, string>;
}

function config() {
  const baseUrl = (process.env.MINERU_BASE_URL || '').replace(/\/+$/, '');
  const backend = process.env.MINERU_BACKEND || 'hybrid-auto-engine';
  const timeoutMs = Number.parseInt(process.env.MINERU_TIMEOUT_MS || '', 10);
  return {
    baseUrl,
    backend,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 600_000,
  };
}

export function isConfigured(): boolean {
  return config().baseUrl.length > 0;
}

/**
 * Parse a document via MinerU. Supports PDF, image, and DOCX files.
 * Throws on HTTP failure — callers typically fall back to lib/document/.
 */
export async function parseFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<MineruResult> {
  const { baseUrl, backend, timeoutMs } = config();
  if (!baseUrl) throw new Error('MINERU_BASE_URL is not configured');

  const url = `${baseUrl}/file_parse`;

  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);
  form.append('backend', backend);
  form.append('return_md', 'true');
  form.append('return_content_list', 'true');
  form.append('return_images', 'true');
  form.append('formula_enable', 'true');
  form.append('table_enable', 'true');
  form.append('response_format_zip', 'false');

  log.info(`Parsing "${fileName}" via MinerU (backend=${backend})`);

  const res = await proxyFetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MinerU API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as MineruParseResponse;
  return normalise(json);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface MineruParseResponse {
  backend?: string;
  results?: Record<
    string,
    {
      md_content?: string;
      content_list?: string | unknown[];
      images?: Record<string, string>;
    }
  >;
}

function normalise(resp: MineruParseResponse): MineruResult {
  const results = resp.results ?? {};
  const firstKey = Object.keys(results)[0];
  const first = firstKey ? results[firstKey] : undefined;
  if (!first) {
    return { markdown: '', contentList: [], images: {} };
  }

  const markdown = first.md_content ?? '';
  const raw = first.content_list;
  let contentList: MineruBlock[] = [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      contentList = parsed.filter(isMineruBlock);
    }
  } catch (err) {
    log.warn('Failed to parse MinerU content_list:', err);
  }

  return {
    markdown,
    contentList,
    images: first.images ?? {},
  };
}

function isMineruBlock(x: unknown): x is MineruBlock {
  if (!x || typeof x !== 'object') return false;
  const t = (x as { type?: unknown }).type;
  return t === 'text' || t === 'image' || t === 'table' || t === 'equation' || t === 'formula';
}
