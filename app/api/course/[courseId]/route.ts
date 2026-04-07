import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

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

  // Cascade deletes via Prisma relations
  await prisma.course.delete({ where: { id: courseId } });

  return apiSuccess({ message: 'Course deleted' });
}
