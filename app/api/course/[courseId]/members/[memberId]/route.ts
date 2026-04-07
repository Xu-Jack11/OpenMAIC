import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; memberId: string }> },
) {
  const { courseId, memberId } = await params;
  const session = await authenticate(req);
  if (!session) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const auth = await authenticateCourse(req, courseId);
  if (!auth || auth.role !== 'TEACHER') {
    return apiError('FORBIDDEN', 403, 'Insufficient course role');
  }

  const member = await prisma.courseMember.findFirst({
    where: { id: memberId, courseId },
  });
  if (!member) return apiError('NOT_FOUND', 404, 'Member not found');

  // Prevent removing the course creator
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (course?.creatorId === member.userId) {
    return apiError('FORBIDDEN', 403, 'Cannot remove the course creator');
  }

  await prisma.courseMember.delete({ where: { id: memberId } });

  return apiSuccess({ message: 'Member removed' });
}
