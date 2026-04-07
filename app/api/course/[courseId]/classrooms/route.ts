import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { runClassroomGenerationJob } from '@/lib/server/classroom-job-runner';
import {
  createClassroomGenerationJob,
  readClassroomGenerationJob,
} from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';

export const maxDuration = 30;

function classroomStatus(storageId: string): 'ready' | 'generating' | 'failed' {
  if (storageId.startsWith('job:')) return 'generating';
  if (storageId.startsWith('failed:')) return 'failed';
  return 'ready';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const auth = await authenticateCourse(req, courseId);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const classrooms = await prisma.classroom.findMany({
    where: { courseId },
    orderBy: { createdAt: 'desc' },
    include: { creator: { select: { id: true, name: true, avatar: true } } },
  });

  return apiSuccess({
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sceneCount: c.sceneCount,
      language: c.language,
      style: c.style,
      status: classroomStatus(c.storageId),
      creator: c.creator,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
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

  try {
    const rawBody = (await req.json()) as Partial<GenerateClassroomInput> & { name?: string };
    const { requirement, name, language } = rawBody;

    if (!requirement?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: requirement');
    }

    const input: GenerateClassroomInput = {
      requirement: requirement.trim(),
      ...(rawBody.pdfContent ? { pdfContent: rawBody.pdfContent } : {}),
      ...(language ? { language } : {}),
      ...(rawBody.enableWebSearch != null ? { enableWebSearch: rawBody.enableWebSearch } : {}),
      ...(rawBody.enableImageGeneration != null
        ? { enableImageGeneration: rawBody.enableImageGeneration }
        : {}),
      ...(rawBody.enableVideoGeneration != null
        ? { enableVideoGeneration: rawBody.enableVideoGeneration }
        : {}),
      ...(rawBody.enableTTS != null ? { enableTTS: rawBody.enableTTS } : {}),
      ...(rawBody.agentMode ? { agentMode: rawBody.agentMode } : {}),
    };

    const baseUrl = buildRequestOrigin(req);
    const jobId = nanoid(10);
    const job = await createClassroomGenerationJob(jobId, input);

    // Create DB row immediately with a placeholder storageId
    const dbClassroom = await prisma.classroom.create({
      data: {
        courseId,
        creatorId: auth.userId,
        name: (name?.trim() || requirement.trim()).substring(0, 200),
        storageId: `job:${jobId}`,
        language: language ?? null,
      },
    });

    after(async () => {
      await runClassroomGenerationJob(jobId, input, baseUrl);
      const completedJob = await readClassroomGenerationJob(jobId);
      if (completedJob?.status === 'succeeded' && completedJob.result?.classroomId) {
        await prisma.classroom.update({
          where: { id: dbClassroom.id },
          data: {
            storageId: completedJob.result.classroomId,
            sceneCount: completedJob.result.scenesCount,
          },
        });
      } else if (completedJob?.status === 'failed') {
        await prisma.classroom.update({
          where: { id: dbClassroom.id },
          data: { storageId: `failed:${jobId}` },
        });
      }
    });

    const pollUrl = `${baseUrl}/api/generate-classroom/${jobId}`;

    return apiSuccess(
      {
        classroomId: dbClassroom.id,
        jobId,
        status: job.status,
        step: job.step,
        message: job.message,
        pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create classroom',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
