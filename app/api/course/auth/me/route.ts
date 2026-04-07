import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) {
    return apiError('UNAUTHORIZED', 401, 'Authentication required');
  }

  const memberships = await prisma.courseMember.findMany({
    where: { userId: auth.userId },
    include: { course: { select: { id: true, name: true, description: true } } },
    orderBy: { joinedAt: 'desc' },
  });

  return apiSuccess({
    user: auth.user,
    courses: memberships.map((m) => ({
      id: m.course.id,
      name: m.course.name,
      description: m.course.description,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  });
}
