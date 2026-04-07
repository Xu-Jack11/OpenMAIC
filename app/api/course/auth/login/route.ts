import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { verifyPassword } from '@/lib/server/auth/password';
import { generateSessionToken, sessionExpiresAt } from '@/lib/server/auth/tokens';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createSessionCookie } from '@/lib/server/auth/tokens';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { account?: string; password?: string };
    const { account, password } = body;

    if (!account?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: account');
    }
    if (!password) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: password');
    }

    const user = await prisma.user.findUnique({
      where: { account: account.trim() },
    });

    if (!user || !user.passwordHash) {
      return apiError('UNAUTHORIZED', 401, 'Invalid account or password');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return apiError('UNAUTHORIZED', 401, 'Invalid account or password');
    }

    const token = generateSessionToken();
    const expiresAt = sessionExpiresAt();
    await prisma.sessionToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    const memberships = await prisma.courseMember.findMany({
      where: { userId: user.id },
      include: { course: { select: { id: true, name: true, description: true } } },
      orderBy: { joinedAt: 'desc' },
    });

    const res = apiSuccess({
      token,
      user: { id: user.id, name: user.name, avatar: user.avatar },
      courses: memberships.map((m) => ({
        id: m.course.id,
        name: m.course.name,
        description: m.course.description,
        role: m.role,
      })),
    });
    res.headers.set('Set-Cookie', createSessionCookie(token));
    return res;
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Login failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
