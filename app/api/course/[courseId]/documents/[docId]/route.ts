import { promises as fs } from 'fs';
import path from 'path';
import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; docId: string }> },
) {
  const { courseId, docId } = await params;
  const auth = await authenticateCourse(req, courseId);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const document = await prisma.document.findFirst({
    where: { id: docId, courseId },
  });
  if (!document) return apiError('NOT_FOUND', 404, 'Document not found');

  const absolutePath = path.join(process.cwd(), document.storagePath);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch {
    return apiError('NOT_FOUND', 404, 'Document file not found on server');
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(document.name)}"`,
      'Content-Length': String(buffer.length),
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; docId: string }> },
) {
  const { courseId, docId } = await params;
  const session = await authenticate(req);
  if (!session) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const auth = await authenticateCourse(req, courseId);
  if (!auth || auth.role !== 'TEACHER') {
    return apiError('FORBIDDEN', 403, 'Insufficient course role');
  }

  const document = await prisma.document.findFirst({
    where: { id: docId, courseId },
  });
  if (!document) return apiError('NOT_FOUND', 404, 'Document not found');

  const absolutePath = path.join(process.cwd(), document.storagePath);
  try {
    await fs.unlink(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await prisma.document.delete({ where: { id: docId } });

  return apiSuccess({ message: 'Document deleted' });
}
