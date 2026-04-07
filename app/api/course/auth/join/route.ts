import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { authenticate } from '@/lib/server/auth/middleware';
import { apiError, apiSuccess } from '@/lib/server/api-response';

async function validateInvite(code: string) {
  const invite = await prisma.invitationCode.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { course: true },
  });
  if (!invite) return { error: 'Invalid invitation code' as const, invite: null };
  if (invite.expiresAt && invite.expiresAt < new Date())
    return { error: 'Invitation code has expired' as const, invite: null };
  if (invite.maxUses !== null && invite.usedCount >= invite.maxUses)
    return { error: 'Invitation code has reached its usage limit' as const, invite: null };
  return { error: null, invite };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth) {
      return apiError('UNAUTHORIZED', 401, 'Authentication required');
    }

    const body = (await req.json()) as {
      code?: string;
    };
    const { code } = body;

    if (!code?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: code');
    }

    const { error: inviteError, invite } = await validateInvite(code);
    if (inviteError || !invite) {
      return apiError('INVITATION_INVALID', 400, inviteError!);
    }

    const existing = await prisma.courseMember.findUnique({
      where: { courseId_userId: { courseId: invite.courseId, userId: auth.userId } },
    });
    if (existing) {
      return apiError('CONFLICT', 409, 'Already a member of this course');
    }

    await prisma.$transaction([
      prisma.courseMember.create({
        data: { courseId: invite.courseId, userId: auth.userId, role: invite.role },
      }),
      prisma.invitationCode.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      }),
    ]);

    return apiSuccess(
      {
        user: auth.user,
        course: {
          id: invite.course.id,
          name: invite.course.name,
          description: invite.course.description,
        },
        role: invite.role,
      },
      201,
    );
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to join course',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
