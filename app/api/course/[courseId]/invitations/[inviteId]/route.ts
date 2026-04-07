import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; inviteId: string }> },
) {
  const { courseId, inviteId } = await params;
  const session = await authenticate(req);
  if (!session) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const auth = await authenticateCourse(req, courseId);
  if (!auth || auth.role !== 'TEACHER') {
    return apiError('FORBIDDEN', 403, 'Insufficient course role');
  }

  const invitation = await prisma.invitationCode.findFirst({
    where: { id: inviteId, courseId },
  });
  if (!invitation) return apiError('NOT_FOUND', 404, 'Invitation not found');

  await prisma.invitationCode.delete({ where: { id: inviteId } });

  return apiSuccess({ message: 'Invitation revoked' });
}
