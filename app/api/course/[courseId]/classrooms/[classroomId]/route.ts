import { promises as fs } from 'fs';
import path from 'path';
import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { readClassroom, CLASSROOMS_DIR } from '@/lib/server/classroom-storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; classroomId: string }> },
) {
  const { courseId, classroomId } = await params;
  const auth = await authenticateCourse(req, courseId);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const dbClassroom = await prisma.classroom.findFirst({
    where: { id: classroomId, courseId },
    include: { creator: { select: { id: true, name: true, avatar: true } } },
  });
  if (!dbClassroom) return apiError('NOT_FOUND', 404, 'Classroom not found');

  const status = dbClassroom.storageId.startsWith('job:')
    ? 'generating'
    : dbClassroom.storageId.startsWith('failed:')
      ? 'failed'
      : 'ready';

  const metadata = {
    id: dbClassroom.id,
    courseId: dbClassroom.courseId,
    name: dbClassroom.name,
    description: dbClassroom.description,
    sceneCount: dbClassroom.sceneCount,
    language: dbClassroom.language,
    style: dbClassroom.style,
    status,
    creator: dbClassroom.creator,
    createdAt: dbClassroom.createdAt,
    updatedAt: dbClassroom.updatedAt,
  };

  if (status !== 'ready') {
    return apiSuccess({ classroom: metadata, content: null });
  }

  const content = await readClassroom(dbClassroom.storageId);
  if (!content) {
    return apiError('NOT_FOUND', 404, 'Classroom content not found on server');
  }

  return apiSuccess({ classroom: metadata, content });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; classroomId: string }> },
) {
  const { courseId, classroomId } = await params;
  const session = await authenticate(req);
  if (!session) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const auth = await authenticateCourse(req, courseId);
  if (!auth || auth.role !== 'TEACHER') {
    return apiError('FORBIDDEN', 403, 'Insufficient course role');
  }

  const dbClassroom = await prisma.classroom.findFirst({
    where: { id: classroomId, courseId },
  });
  if (!dbClassroom) return apiError('NOT_FOUND', 404, 'Classroom not found');

  // Delete filesystem content if it exists
  if (!dbClassroom.storageId.startsWith('job:') && !dbClassroom.storageId.startsWith('failed:')) {
    const filePath = path.join(CLASSROOMS_DIR, `${dbClassroom.storageId}.json`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // File not found is acceptable — the DB row still needs to be deleted
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  await prisma.classroom.delete({ where: { id: classroomId } });

  return apiSuccess({ message: 'Classroom deleted' });
}
