import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate, authenticateCourse } from '@/lib/server/auth/middleware';
import { generateInvitationCode } from '@/lib/server/auth/tokens';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const session = await authenticate(req);
  if (!session) return apiError('UNAUTHORIZED', 401, 'Authentication required');

  const auth = await authenticateCourse(req, courseId);
  if (!auth || auth.role !== 'TEACHER') {
    return apiError('FORBIDDEN', 403, 'Insufficient course role');
  }

  const invitations = await prisma.invitationCode.findMany({
    where: { courseId },
    orderBy: { createdAt: 'desc' },
  });

  return apiSuccess({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      code: inv.code,
      role: inv.role,
      maxUses: inv.maxUses,
      usedCount: inv.usedCount,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      isActive:
        (inv.maxUses === null || inv.usedCount < inv.maxUses) &&
        (inv.expiresAt === null || inv.expiresAt > new Date()),
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

  const body = (await req.json()) as {
    role?: 'TEACHER' | 'STUDENT';
    maxUses?: number | null;
    expiresInDays?: number | null;
  };
  const { role = 'STUDENT', maxUses = null, expiresInDays = null } = body;

  if (role !== 'TEACHER' && role !== 'STUDENT') {
    return apiError('INVALID_REQUEST', 400, 'role must be TEACHER or STUDENT');
  }

  const expiresAt =
    expiresInDays != null ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

  // Generate a unique code (retry up to 5 times on collision)
  let code = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInvitationCode();
    const existing = await prisma.invitationCode.findUnique({ where: { code: candidate } });
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    return apiError('INTERNAL_ERROR', 500, 'Failed to generate unique invitation code');
  }

  const invitation = await prisma.invitationCode.create({
    data: {
      code,
      courseId,
      role,
      maxUses: maxUses ?? null,
      expiresAt,
      createdBy: auth.userId,
    },
  });

  return apiSuccess(
    {
      invitation: {
        id: invitation.id,
        code: invitation.code,
        role: invitation.role,
        maxUses: invitation.maxUses,
        usedCount: invitation.usedCount,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
    },
    201,
  );
}
