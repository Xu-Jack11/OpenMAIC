import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticateCourse } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const auth = await authenticateCourse(req, courseId);
  if (!auth) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const members = await prisma.courseMember.findMany({
    where: { courseId },
    include: { user: { select: { id: true, name: true, avatar: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  return apiSuccess({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    })),
  });
}
