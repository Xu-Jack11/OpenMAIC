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

  const body = (await req.json()) as {
    stage?: Stage;
    scenes?: Scene[];
    name?: string;
    language?: string;
    style?: string;
  };

  const { stage, scenes } = body;
  if (!stage?.id || !Array.isArray(scenes) || scenes.length === 0) {
    return apiError('INVALID_REQUEST', 400, 'stage and scenes are required');
  }

  // Persist classroom content to filesystem
  const classroomData: PersistedClassroomData = {
    id: stage.id,
    stage,
    scenes,
    createdAt: new Date().toISOString(),
  };

  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${stage.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  // Create database record
  const classroom = await prisma.classroom.create({
    data: {
      courseId,
      creatorId: auth.userId,
      name: body.name || stage.name || 'Untitled',
      storageId: stage.id,
      sceneCount: scenes.length,
      language: body.language || stage.language || null,
      style: body.style || stage.style || null,
    },
  });

  return apiSuccess({ classroomId: classroom.id, storageId: stage.id }, 201);
}
