import { NextRequest } from 'next/server';
import { parseDocument } from '@/lib/document/parse-document';
import { resolvePDFApiKey, resolvePDFBaseUrl } from '@/lib/server/provider-config';
import { DOCUMENT_FORMAT_IDS, type DocumentFormatId } from '@/lib/document/types';
import type { ParsedDocumentContent } from '@/lib/document/types';
import type { PDFProviderId } from '@/lib/pdf/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
const log = createLogger('Parse Document');

export async function POST(req: NextRequest) {
  let fileName: string | undefined;
  let resolvedFormat: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      log.error('Invalid Content-Type for document upload:', contentType);
      return apiError(
        'INVALID_REQUEST',
        400,
        `Invalid Content-Type: expected multipart/form-data, got "${contentType}"`,
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const formatValue = formData.get('format');

    // PDF specific fields
    const providerId = formData.get('providerId') as string | null;
    const apiKey = formData.get('apiKey') as string | null;
    const baseUrl = formData.get('baseUrl') as string | null;

    if (!(file instanceof File)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No file provided');
    }

    if (typeof formatValue !== 'string' && formatValue !== null) {
      return apiError('INVALID_REQUEST', 400, 'Invalid format field');
    }

    const format = (formatValue || null) as DocumentFormatId | null;
    if (format && !DOCUMENT_FORMAT_IDS.includes(format)) {
      return apiError('INVALID_REQUEST', 400, `Unsupported format: ${format}`);
    }

    fileName = file?.name;
    resolvedFormat = format || 'auto';

    const clientBaseUrl = baseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    // Resolve API key and Base URL only if providerId is set (PDF specific for now)
    const effectiveProviderId = providerId || undefined;
    const resolvedApiKey = effectiveProviderId
      ? clientBaseUrl
        ? apiKey || ''
        : resolvePDFApiKey(effectiveProviderId as PDFProviderId, apiKey || undefined)
      : apiKey || undefined;

    const resolvedBaseUrl = effectiveProviderId
      ? clientBaseUrl
        ? clientBaseUrl
        : resolvePDFBaseUrl(effectiveProviderId as PDFProviderId, baseUrl || undefined)
      : clientBaseUrl;

    const config = {
      format: format || undefined,
      providerId: effectiveProviderId,
      apiKey: resolvedApiKey,
      baseUrl: resolvedBaseUrl,
    };

    // Parse document
    const result = await parseDocument(config, file);

    // Add file metadata
    const resultWithMetadata: ParsedDocumentContent = {
      ...result,
      metadata: {
        pageCount: result.metadata?.pageCount || 1,
        ...result.metadata,
        fileName: file.name,
        fileSize: file.size,
      },
    };

    return apiSuccess({ data: resultWithMetadata });
  } catch (error) {
    log.error(
      `Document parsing failed [format=${resolvedFormat ?? 'unknown'}, file="${fileName ?? 'unknown'}"]:`,
      error,
    );
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
