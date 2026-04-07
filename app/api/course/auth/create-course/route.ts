import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) {
      return apiError('UNAUTHORIZED', 401, 'Authentication required');
    }

    const body = (await req.json()) as { courseName?: string };
    const { courseName } = body;

    if (!courseName?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: courseName');
    }

    const course = await prisma.course.create({
      data: { name: courseName.trim(), creatorId: auth.userId },
    });
    await prisma.courseMember.create({
      data: { courseId: course.id, userId: auth.userId, role: 'TEACHER' },
    });

    return apiSuccess(
      {
        user: auth.user,
        course: {
          id: course.id,
          name: course.name,
          description: course.description,
          createdAt: course.createdAt,
        },
        role: 'TEACHER',
      },
      201,
    );
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create course',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
