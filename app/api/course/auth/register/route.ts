import { type NextRequest } from 'next/server';
import { Prisma } from '@/lib/generated/prisma/client';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { hashPassword } from '@/lib/server/auth/password';
import { createSessionCookie, generateSessionToken, sessionExpiresAt } from '@/lib/server/auth/tokens';
import { prisma } from '@/lib/server/db';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      account?: string;
      password?: string;
      avatar?: string;
    };

    const name = body.name?.trim();
    const account = body.account?.trim();
    const { password } = body;

    if (!name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: name');
    }
    if (!account) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: account');
    }
    if (!password || password.length < 6) {
      return apiError('INVALID_REQUEST', 400, 'Password must be at least 6 characters');
    }

    const existing = await prisma.user.findUnique({ where: { account } });
    if (existing) {
      return apiError('ACCOUNT_EXISTS', 409, 'This account name is already taken');
    }

    const passwordHash = await hashPassword(password);
    const token = generateSessionToken();
    const expiresAt = sessionExpiresAt();

    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdUser = await tx.user.create({
        data: {
          name,
          account,
          passwordHash,
          avatar: body.avatar ?? null,
        },
      });

      await tx.sessionToken.create({
        data: {
          token,
          userId: createdUser.id,
          expiresAt,
        },
      });

      return createdUser;
    });

    const res = apiSuccess(
      {
        token,
        user: {
          id: user.id,
          name: user.name,
          avatar: user.avatar,
        },
        courses: [],
      },
      201,
    );

    res.headers.set('Set-Cookie', createSessionCookie(token));
    return res;
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Register failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
