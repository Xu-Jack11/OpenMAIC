import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  ensureClassroomsDir,
  writeJsonFileAtomic,
  CLASSROOMS_DIR,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';
import path from 'path';
import type { Stage, Scene } from '@/lib/types/stage';

export async function PATCH(
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

  if (dbClassroom.storageId.startsWith('job:') || dbClassroom.storageId.startsWith('failed:')) {
    return apiError('INVALID_REQUEST', 400, 'Cannot update classroom that is not ready');
  }

  const body = (await req.json()) as { stage?: Stage; scenes?: Scene[] };
  const { stage, scenes } = body;
  if (!stage || !Array.isArray(scenes)) {
    return apiError('INVALID_REQUEST', 400, 'stage and scenes are required');
  }

  const classroomData: PersistedClassroomData = {
    id: dbClassroom.storageId,
    stage,
    scenes,
    createdAt: dbClassroom.createdAt.toISOString(),
  };

  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${dbClassroom.storageId}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  // Update metadata
  await prisma.classroom.update({
    where: { id: classroomId },
    data: {
      sceneCount: scenes.length,
      name: stage.name || dbClassroom.name,
    },
  });

  return apiSuccess({ message: 'Content saved' });
}
