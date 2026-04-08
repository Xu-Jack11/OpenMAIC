import { promises as fs } from 'fs';
import path from 'path';
import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { indexDocument } from '@/lib/rag';
import { createLogger } from '@/lib/logger';

const log = createLogger('Documents API');

const DOCUMENTS_DIR = path.join(process.cwd(), 'data', 'documents');

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const auth = await authenticateCourse(req, courseId);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const documents = await prisma.document.findMany({
    where: { courseId },
    orderBy: { createdAt: 'desc' },
    include: { uploader: { select: { id: true, name: true, avatar: true } } },
  });

  return apiSuccess({
    documents: documents.map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      indexStatus: d.indexStatus,
      uploader: d.uploader,
      createdAt: d.createdAt,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const session = await authenticate(req);
  if (!session) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const auth = await authenticateCourse(req, courseId);
  if (!auth || auth.role !== 'TEACHER') {
    return apiError('FORBIDDEN', 403, 'Insufficient course role');
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: file');

  const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
  if (file.size > MAX_SIZE) {
    return apiError('INVALID_REQUEST', 400, 'File exceeds maximum size of 50 MB');
  }

  const ext = MIME_TO_EXT[file.type] ?? path.extname(file.name) ?? '';
  const docId = nanoid();
  const storagePath = path.join(DOCUMENTS_DIR, courseId, `${docId}${ext}`);

  await fs.mkdir(path.join(DOCUMENTS_DIR, courseId), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storagePath, buffer);

  const document = await prisma.document.create({
    data: {
      courseId,
      uploaderId: auth.userId,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storagePath: path.relative(process.cwd(), storagePath),
      indexStatus: 'pending',
    },
  });

  // Trigger async indexing for RAG
  after(async () => {
    try {
      log.info(`Starting async indexing for document: ${document.id}`);
      await indexDocument(document.id);
    } catch (err) {
      log.error(`Failed to index document ${document.id}:`, err);
    }
  });

  return apiSuccess(
    {
      document: {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        indexStatus: document.indexStatus,
        createdAt: document.createdAt,
      },
    },
    201,
  );
}
