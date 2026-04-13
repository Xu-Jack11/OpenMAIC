import { promises as fs } from 'fs';
import path from 'path';
import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import * as ragflow from '@/lib/rag/ragflow-client';

const log = createLogger('Course DELETE');

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const auth = await authenticateCourse(req, courseId);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      _count: { select: { members: true, classrooms: true, documents: true } },
    },
  });
  if (!course) return apiError('NOT_FOUND', 404, 'Course not found');

  return apiSuccess({
    course: {
      id: course.id,
      name: course.name,
      description: course.description,
      creatorId: course.creatorId,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      memberCount: course._count.members,
      classroomCount: course._count.classrooms,
      documentCount: course._count.documents,
    },
    role: auth.role,
  });
}

export async function PATCH(
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

  const body = (await req.json()) as { name?: string; description?: string };
  const { name, description } = body;

  if (name !== undefined && !name.trim()) {
    return apiError('INVALID_REQUEST', 400, 'Course name cannot be empty');
  }

  const course = await prisma.course.update({
    where: { id: courseId },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
    },
  });

  return apiSuccess({
    course: { id: course.id, name: course.name, description: course.description },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const auth = await authenticate(req);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return apiError('NOT_FOUND', 404, 'Course not found');
  if (course.creatorId !== auth.userId) {
    return apiError('FORBIDDEN', 403, 'Only the course creator can delete the course');
  }

  // Clean up on-disk artifacts before cascading the DB delete.
  // Filesystem errors are logged but do NOT block the DB delete — orphan files
  // are recoverable, but a stuck DB row is worse.
  try {
    const classrooms = await prisma.classroom.findMany({
      where: { courseId },
      select: { storageId: true },
    });
    for (const { storageId } of classrooms) {
      if (storageId.startsWith('job:') || storageId.startsWith('failed:')) continue;
      const filePath = path.join(CLASSROOMS_DIR, `${storageId}.json`);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warn(`Failed to unlink classroom file ${filePath}:`, err);
        }
      }
    }
  } catch (err) {
    log.warn('Failed to enumerate classrooms for cleanup:', err);
  }

  try {
    const documentsDir = path.join(process.cwd(), 'data', 'documents', courseId);
    await fs.rm(documentsDir, { recursive: true, force: true });
  } catch (err) {
    log.warn('Failed to remove documents directory:', err);
  }

  // Clean up RAGFlow dataset
  if (course.ragflowDatasetId && ragflow.isConfigured()) {
    try {
      await ragflow.deleteDataset(course.ragflowDatasetId);
    } catch (err) {
      log.warn('Failed to delete RAGFlow dataset:', err);
    }
  }

  // Cascade deletes via Prisma relations (classrooms, documents, members, invites)
  await prisma.course.delete({ where: { id: courseId } });

  return apiSuccess({ message: 'Course deleted' });
}
